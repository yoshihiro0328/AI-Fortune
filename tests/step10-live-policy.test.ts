import { describe, it, expect } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { fixturePlan } from "../scripts/phase6/step10-fixtures.mjs";
import {
  context,
  origin,
  externalAllowed,
  roleOf,
  incomingAllowed,
} from "../scripts/phase6/step10-live-policy.mjs";
const key = (role: string) =>
  "x." +
  Buffer.from(JSON.stringify({ ref: "ukdzggjfkcwjssjmnqim", role })).toString(
    "base64url",
  ) +
  ".fixture";
const secret = "a".repeat(64),
  raw = ["synth-a", "synth-b", "synth-forged"];
const r = {
  NEXT_PUBLIC_SUPABASE_URL: origin,
  NEXT_PUBLIC_APP_URL: "http://localhost:5208",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: key("anon"),
  SUPABASE_SERVICE_ROLE_KEY: key("service_role"),
  SESSION_SECRET: secret,
  STRIPE_MODE: "sandbox",
  STRIPE_ACCOUNT_ID: "acct_1UQlQdI73kTcvXz8",
  TRIAL_ENABLED: "false",
  TRIAL_RETENTION_VERIFIED: "false",
  TRIAL_BUDGET_VERIFIED: "false",
  STRIPE_LIVE_CHECKOUT_ENABLED: "false",
  PREVIEW_DEMO_ENABLED: "false",
  PUBLIC_INDEXING_ENABLED: "false",
};
const p = fixturePlan(
    [randomUUID(), randomUUID()],
    raw
      .slice(0, 2)
      .map((v) => createHmac("sha256", secret).update(v).digest("hex")),
  ),
  c = context(r, p, raw);
const allow = (
  path: string,
  method = "GET",
  body = {},
  role = "service",
  stage = "run",
) => externalAllowed(origin + path, method, body, c, role, stage);
describe("STEP10 live guard", () => {
  it("rejects old DB", () =>
    expect(() =>
      context(
        {
          ...r,
          NEXT_PUBLIC_SUPABASE_URL: "https://rnvrdrfdbapfafwjbygo.supabase.co",
        },
        p,
        raw,
      ),
    ).toThrow());
  it("rejects enabled trial", () =>
    expect(() => context({ ...r, TRIAL_ENABLED: "true" }, p, raw)).toThrow());
  it("rejects provider credential", () =>
    expect(() =>
      context({ ...r, OPENAI_API_KEY: "fixture" }, p, raw),
    ).toThrow());
  it("rejects copied session", () =>
    expect(() =>
      context(r, p, ["synth-a", "synth-a", "synth-forged"]),
    ).toThrow());
  it("rejects wrong role key", () =>
    expect(() =>
      context({ ...r, SUPABASE_SERVICE_ROLE_KEY: key("anon") }, p, raw),
    ).toThrow());
  it("rejects an unknown credential", () =>
    expect(roleOf("unknown", "unknown", c)).toBeNull());
  it("cannot combine anon key with service token", () =>
    expect(
      roleOf(r.NEXT_PUBLIC_SUPABASE_ANON_KEY, r.SUPABASE_SERVICE_ROLE_KEY, c),
    ).toBeNull());
  for (const path of [
    "/auth/v1/signup",
    "/auth/v1/recover",
    "/auth/v1/resend",
    "/auth/v1/logout",
    "/auth/v1/token?grant_type=refresh_token",
    "/rest/v1/rpc/arbitrary",
    "/rest/v1/diagnoses",
  ])
    it("rejects POST " + path, () => expect(allow(path, "POST")).toBe(false));
  for (const host of [
    "https://api.stripe.com",
    "https://api.openai.com",
    "https://rnvrdrfdbapfafwjbygo.supabase.co",
  ])
    it("rejects " + host, () =>
      expect(
        externalAllowed(
          host + "/rest/v1/diagnoses",
          "GET",
          {},
          c,
          "service",
          "run",
        ),
      ).toBe(false),
    );
  it("keeps capture stage read-only", () =>
    expect(
      allow(
        "/rest/v1/rpc/claim_anonymous_diagnoses",
        "POST",
        { p_user: p.users[0], p_session: p.hashes[0] },
        "service",
        "capture",
      ),
    ).toBe(false));
  it("allows only the manifest claim", () =>
    expect(
      allow("/rest/v1/rpc/claim_anonymous_diagnoses", "POST", {
        p_user: p.users[0],
        p_session: p.hashes[0],
      }),
    ).toBe(true));
  it("denies unknown claim session", () =>
    expect(
      allow("/rest/v1/rpc/claim_anonymous_diagnoses", "POST", {
        p_user: p.users[0],
        p_session: "unrelated",
      }),
    ).toBe(false));
  it("denies unknown user", () =>
    expect(
      allow("/rest/v1/rpc/claim_anonymous_diagnoses", "POST", {
        p_user: randomUUID(),
        p_session: p.hashes[0],
      }),
    ).toBe(false));
  it("does not relax rate limits", () =>
    expect(
      allow("/rest/v1/rpc/consume_limit", "POST", {
        p_key: c.ipKey,
        p_limit: 999,
        p_seconds: 3600,
      }),
    ).toBe(false));
  it("allows exact rate budget", () =>
    expect(
      allow("/rest/v1/rpc/consume_limit", "POST", {
        p_key: c.ipKey,
        p_limit: 40,
        p_seconds: 3600,
      }),
    ).toBe(true));
  it("denies rate reset and deletes", () =>
    expect(allow("/rest/v1/rate_limits", "DELETE")).toBe(false));
  it("denies all fixture deletes", () =>
    expect(
      allow("/rest/v1/diagnoses?id=eq." + p.rows.diagnoses[0], "DELETE"),
    ).toBe(false));
  it("permits manifest owner denial probe with user token", () =>
    expect(
      allow(
        "/rest/v1/diagnoses?id=eq." + p.rows.diagnoses[0],
        "PATCH",
        { user_id: p.users[1] },
        "user",
      ),
    ).toBe(true));
  it("denies owner update with service role", () =>
    expect(
      allow("/rest/v1/diagnoses?id=eq." + p.rows.diagnoses[0], "PATCH", {
        user_id: p.users[1],
      }),
    ).toBe(false));
  it("denies patch of unknown row", () =>
    expect(
      allow(
        "/rest/v1/diagnoses?id=eq." + randomUUID(),
        "PATCH",
        { user_id: p.users[1] },
        "user",
      ),
    ).toBe(false));
  it("denies extra patched columns", () =>
    expect(
      allow(
        "/rest/v1/diagnoses?id=eq." + p.rows.diagnoses[0],
        "PATCH",
        { user_id: p.users[1], status: "paid" },
        "user",
      ),
    ).toBe(false));
  it("allows application GET", () =>
    expect(incomingAllowed("/api/consultations", "GET", {})).toBe(true));
  it("denies consultation POST", () =>
    expect(
      incomingAllowed("/api/consultations", "POST", { action: "send" }),
    ).toBe(false));
  it("allows only claim action", () =>
    expect(incomingAllowed("/api/auth", "POST", { action: "claim" })).toBe(
      true,
    ));
  it("denies new signup", () =>
    expect(incomingAllowed("/api/auth", "POST", { action: "signup" })).toBe(
      false,
    ));
  it("denies trial route", () =>
    expect(incomingAllowed("/api/trial/session", "POST", {})).toBe(false));
});
