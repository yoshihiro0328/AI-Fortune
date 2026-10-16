import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  externalAllowed,
  incomingAllowed,
  authActionAllowed,
  reserveSignup,
  origin,
} from "../scripts/phase6/auth-session-policy.mjs";
const signup = {
  email: "a@example.test",
  password: "fixture-only",
  code_challenge_method: "s256",
  code_challenge: "a".repeat(43),
};
const url =
  origin +
  "/auth/v1/signup?redirect_to=" +
  encodeURIComponent("http://localhost:5198/auth/callback");
describe("STEP9 scope and irreversible mail reservations (offline)", () => {
  it("allows exact PKCE signup destination", () =>
    expect(externalAllowed(url, "POST", signup)).toBe(true));
  for (const host of [
    "https://rnvrdrfdbapfafwjbygo.supabase.co",
    "https://api.stripe.com",
    "https://api.openai.com",
    "http://ukdzggjfkcwjssjmnqim.supabase.co",
  ])
    it("rejects " + host, () =>
      expect(externalAllowed(url.replace(origin, host), "POST", signup)).toBe(
        false,
      ),
    );
  for (const route of [
    "resend",
    "recover",
    "verify",
    "invite",
    "admin/users",
    "otp",
  ])
    it("blocks " + route, () =>
      expect(
        externalAllowed(origin + "/auth/v1/" + route, "POST", signup),
      ).toBe(false),
    );
  for (const grant of ["password", "pkce", "refresh_token"])
    it("allows " + grant, () =>
      expect(
        externalAllowed(
          origin + "/auth/v1/token?grant_type=" + grant,
          "POST",
          {},
        ),
      ).toBe(true),
    );
  it("requires PKCE", () =>
    expect(
      externalAllowed(url, "POST", {
        ...signup,
        code_challenge_method: "plain",
      }),
    ).toBe(false));
  it("rejects wrong callback", () =>
    expect(externalAllowed(url.replace("5198", "5197"), "POST", signup)).toBe(
      false,
    ));
  it("blocks arbitrary RPC", () =>
    expect(
      externalAllowed(origin + "/rest/v1/rpc/trial_claim", "POST", {}),
    ).toBe(false));
  it("allows bounded auth rate RPC", () =>
    expect(
      externalAllowed(origin + "/rest/v1/rpc/consume_limit", "POST", {
        p_key: "auth:login:abcd",
        p_limit: 10,
        p_seconds: 3600,
      }),
    ).toBe(true));
  it("rejects privilege-shaped extra RPC fields", () =>
    expect(
      externalAllowed(origin + "/rest/v1/rpc/consume_limit", "POST", {
        p_key: "auth:login:abcd",
        p_limit: 10,
        p_seconds: 3600,
        admin: true,
      }),
    ).toBe(false));
  it("denies unapproved recipients", () =>
    expect(
      authActionAllowed(
        { action: "signup", email: "x@example.test" },
        { a: "a@example.test", b: "b@example.test" },
        "a",
      ),
    ).toBe(false));
  it("denies B before A success", () =>
    expect(
      authActionAllowed(
        { action: "signup", email: "b@example.test" },
        { a: "a@example.test", b: "b@example.test" },
        "a",
      ),
    ).toBe(false));
  it("allows A at A stage", () =>
    expect(
      authActionAllowed(
        { action: "signup", email: "a@example.test" },
        { a: "a@example.test", b: "b@example.test" },
        "a",
      ),
    ).toBe(true));
  it("blocks reset even approved address", () =>
    expect(
      authActionAllowed(
        { action: "reset", email: "a@example.test" },
        { a: "a@example.test" },
        "a",
      ),
    ).toBe(false));
  it("denies wrong incoming host", () =>
    expect(incomingAllowed("/api/auth", "POST", "evil.test")).toBe(false));
  it("allows real auth route", () =>
    expect(incomingAllowed("/api/auth", "POST", "localhost:5198")).toBe(true));
  it("denies unrelated writes", () =>
    expect(incomingAllowed("/api/diagnoses", "POST", "localhost:5198")).toBe(
      false,
    ));
  it("allows callback but not recovery route", () => {
    expect(incomingAllowed("/auth/callback", "GET", "localhost:5198")).toBe(
      true,
    );
    expect(incomingAllowed("/auth/confirm", "GET", "localhost:5198")).toBe(
      false,
    );
  });
  it("reservation survives duplicate and fresh caller and contains no addresses", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "auth-ledger-"));
    try {
      reserveSignup(d, "a");
      expect(() => reserveSignup(d, "a")).toThrow();
      expect(
        fs.readFileSync(path.join(d, "signup-a.reserved"), "utf8"),
      ).not.toContain("@");
      expect(fs.statSync(path.join(d, "signup-a.reserved")).mode & 0o777).toBe(
        0o600,
      );
      reserveSignup(d, "b");
      expect(() => reserveSignup(d, "b")).toThrow();
      expect(() => reserveSignup(d, "c")).toThrow();
    } finally {
      fs.rmSync(d, { recursive: true });
    }
  });
});
