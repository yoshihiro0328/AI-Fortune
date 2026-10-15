import { expect, it } from "vitest";
import {
  allowedExternal,
  allowedIncoming,
  validateRuntime,
  origin,
} from "../scripts/phase6/local-auth-policy.mjs";
it("allows only the new project read endpoints", () =>
  expect(
    allowedExternal(origin + "/rest/v1/diagnosis_questions?select=id"),
  ).toBe(true));
it.each([
  [
    "https://rnvrdrfdbapfafwjbygo.supabase.co/rest/v1/diagnosis_questions",
    "GET",
  ],
  ["https://api.stripe.com/v1/account", "GET"],
  ["https://api.openai.com/v1/responses", "POST"],
  [origin + "/auth/v1/signup", "POST"],
  [origin + "/auth/v1/verify", "GET"],
  [origin + "/rest/v1/rpc/consume_limit", "GET"],
  [origin + "/rest/v1/diagnoses", "POST"],
  [origin + ".evil.invalid/rest/v1/diagnoses", "GET"],
  ["https://secret@ukdzggjfkcwjssjmnqim.supabase.co/rest/v1/diagnoses", "GET"],
  [origin + "/rest/v1/diagnoses#fragment", "GET"],
])("rejects outbound %s %s", (url, method) =>
  expect(allowedExternal(url, method)).toBe(false),
);
it("allows read-only account display", () =>
  expect(allowedIncoming("/account", "GET", "localhost:5198")).toBe(true));
it.each([
  ["/api/auth", "POST", "localhost:5198"],
  ["/auth/callback", "GET", "localhost:5198"],
  ["/api/cron/mail", "GET", "localhost:5198"],
  ["/_next/image", "GET", "localhost:5198"],
  ["/account", "GET", "evil.invalid"],
])("blocks unsafe incoming %s %s %s", (path, method, host) =>
  expect(allowedIncoming(path, method, host)).toBe(false),
);
const jwt = (role: string, ref = "ukdzggjfkcwjssjmnqim") =>
  "fake." +
  Buffer.from(JSON.stringify({ role, ref })).toString("base64url") +
  ".unsigned";
const good = () => ({
  NEXT_PUBLIC_SUPABASE_URL: origin,
  NEXT_PUBLIC_APP_URL: "http://localhost:5198",
  STRIPE_MODE: "sandbox",
  TRIAL_ENABLED: "false",
  TRIAL_RETENTION_VERIFIED: "false",
  TRIAL_BUDGET_VERIFIED: "false",
  STRIPE_LIVE_CHECKOUT_ENABLED: "false",
  PREVIEW_DEMO_ENABLED: "false",
  PUBLIC_INDEXING_ENABLED: "false",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
  SESSION_SECRET: "a".repeat(64),
});
it("validates key labels only, without claiming signature verification", () =>
  expect(() => validateRuntime(good())).not.toThrow());
it("rejects wrong project credentials", () =>
  expect(() =>
    validateRuntime({
      ...good(),
      SUPABASE_SERVICE_ROLE_KEY: jwt("service_role", "rnvrdrfdbapfafwjbygo"),
    }),
  ).toThrow("Wrong"));
it("rejects switched anon and service credentials", () =>
  expect(() =>
    validateRuntime({
      ...good(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role"),
    }),
  ).toThrow("Wrong"));
it("rejects enabled anonymous generation", () =>
  expect(() => validateRuntime({ ...good(), TRIAL_ENABLED: "true" })).toThrow(
    "Unsafe",
  ));
it("rejects unrelated provider secrets", () =>
  expect(() =>
    validateRuntime({ ...good(), OPENAI_API_KEY: "synthetic" }),
  ).toThrow("Forbidden"));
it("rejects a Vercel runtime", () =>
  expect(() => validateRuntime({ ...good(), VERCEL_ENV: "preview" })).toThrow(
    "Forbidden",
  ));
