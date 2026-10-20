import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  localPaymentIntegration,
  assertIntegrationDiagnosis,
  paymentIntegrationRequestAllowed,
} from "@/lib/stripe/local-integration";
import {
  localPaymentEnv,
  paymentFixtureDiagnosis as id,
} from "./helpers/payment-integration";
import { stripe } from "@/lib/stripe/client";
import { runAI } from "@/lib/ai/run";
import { generatePaid } from "@/lib/ai/pipeline";
afterEach(() => vi.unstubAllEnvs());
it("normal mode stays unchanged and local mode does not fake payment entitlement", () => {
  vi.stubEnv("PAYMENT_INTEGRATION_LOCAL", undefined);
  expect(localPaymentIntegration()).toBe(false);
  localPaymentEnv();
  expect(localPaymentIntegration()).toBe(true);
  expect(() => assertIntegrationDiagnosis(id)).not.toThrow();
  expect(() => assertIntegrationDiagnosis("another-diagnosis")).toThrow();
});
it.each([
  ["PAYMENT_INTEGRATION_LOCAL", "TRUE"],
  ["NODE_ENV", "production"],
  ["VERCEL_ENV", "preview"],
  ["VERCEL", "1"],
  ["VERCEL_PROJECT_ID", "prj_fixture"],
  ["NEXT_PUBLIC_APP_URL", "https://fixture.invalid"],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://other.invalid"],
  ["STRIPE_ACCOUNT_ID", "acct_other"],
  ["STRIPE_MODE", "live"],
  ["OPENAI_API_KEY", "fixture"],
  ["AI_GATEWAY_API_KEY", "fixture"],
  ["TRIAL_ENABLED", "true"],
  ["TRIAL_RETENTION_VERIFIED", "true"],
  ["TRIAL_BUDGET_VERIFIED", "true"],
  ["PUBLIC_INDEXING_ENABLED", "true"],
  ["PREVIEW_DEMO_ENABLED", "true"],
  ["STRIPE_LIVE_CHECKOUT_ENABLED", "true"],
  ["PAYMENT_INTEGRATION_DIAGNOSIS_ID", "invalid"],
])("fails closed for %s", (name, value) => {
  localPaymentEnv();
  vi.stubEnv(name, value);
  expect(localPaymentIntegration).toThrow("Invalid local");
});
it.each([
  ["POST", "/api/billing"],
  ["GET", "/api/billing"],
  ["GET", "/api/cron/reports"],
  ["POST", "/api/consultations"],
  ["POST", `/api/diagnoses/${id}/report`],
  ["POST", `/api/diagnoses/${id}/analyze`],
  ["POST", "/api/auth/confirm"],
  ["GET", "/auth/callback"],
  ["GET", "/_next/image"],
  ["DELETE", `/api/diagnoses/${id}`],
  ["POST", "/api/diagnoses/other/checkout"],
])("local inbound policy rejects %s %s", (method, path) => {
  localPaymentEnv();
  expect(paymentIntegrationRequestAllowed(method, path)).toBe(false);
});
it("allows only fixture Checkout, signed-webhook handler and reads needed for ownership tests", () => {
  localPaymentEnv();
  for (const [method, path] of [
    ["POST", `/api/diagnoses/${id}/checkout`],
    ["POST", "/api/webhooks/stripe"],
    ["POST", "/api/auth"],
    ["GET", `/api/diagnoses/${id}/report`],
    ["GET", "/api/diagnoses"],
  ])
    expect(paymentIntegrationRequestAllowed(method, path)).toBe(true);
});
it("requires a restricted test key without contacting Stripe", () => {
  localPaymentEnv();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  expect(stripe).toThrow("restricted Sandbox key");
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_fixture");
  expect(stripe().getMaxNetworkRetries()).toBe(0);
});
it("stops AI and report generation before credentials, DB writes or external calls", async () => {
  localPaymentEnv();
  await expect(
    runAI(id, "paid_report", "fixture", z.string(), {}),
  ).rejects.toThrow("AI generation is disabled");
  await expect(generatePaid(id)).rejects.toThrow("AI generation is disabled");
});
