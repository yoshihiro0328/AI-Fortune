import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  localSubscriptionIntegration,
  subscriptionRequestAllowed,
} from "@/lib/stripe/local-subscription";
import { stripe } from "@/lib/stripe/client";
import { runAI } from "@/lib/ai/run";
import { generatePaid } from "@/lib/ai/pipeline";
function environment() {
  for (const [k, v] of Object.entries({
    NODE_ENV: "test",
    SUBSCRIPTION_INTEGRATION_LOCAL: "true",
    PAYMENT_INTEGRATION_LOCAL: "false",
    NEXT_PUBLIC_APP_URL: "http://localhost:5218",
    NEXT_PUBLIC_SUPABASE_URL: "https://ukdzggjfkcwjssjmnqim.supabase.co",
    STRIPE_ACCOUNT_ID: "acct_1UQlQdI73kTcvXz8",
    STRIPE_MODE: "sandbox",
    SUBSCRIPTION_BUYER_ID: "30000000-0000-4000-8000-000000000002",
    TRIAL_ENABLED: "false",
    TRIAL_RETENTION_VERIFIED: "false",
    TRIAL_BUDGET_VERIFIED: "false",
    PREVIEW_DEMO_ENABLED: "false",
    PUBLIC_INDEXING_ENABLED: "false",
    STRIPE_LIVE_CHECKOUT_ENABLED: "false",
  }))
    vi.stubEnv(k, v);
  for (const k of [
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_PROJECT_ID",
    "OPENAI_API_KEY",
    "AI_GATEWAY_API_KEY",
  ])
    vi.stubEnv(k, undefined);
}
afterEach(() => vi.unstubAllEnvs());
it("normal deployments do not enter subscription integration mode", () => {
  vi.stubEnv("SUBSCRIPTION_INTEGRATION_LOCAL", undefined);
  expect(localSubscriptionIntegration()).toBe(false);
  environment();
  expect(localSubscriptionIntegration()).toBe(true);
});
it.each([
  ["NODE_ENV", "production"],
  ["VERCEL_ENV", "preview"],
  ["VERCEL", "1"],
  ["VERCEL_PROJECT_ID", "prj_test"],
  ["PAYMENT_INTEGRATION_LOCAL", "true"],
  ["SUBSCRIPTION_INTEGRATION_LOCAL", "TRUE"],
  ["NEXT_PUBLIC_APP_URL", "http://localhost:5208"],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://other.invalid"],
  ["STRIPE_ACCOUNT_ID", "acct_other"],
  ["STRIPE_MODE", "live"],
  ["OPENAI_API_KEY", "synthetic"],
  ["AI_GATEWAY_API_KEY", "synthetic"],
  ["TRIAL_ENABLED", "true"],
  ["PUBLIC_INDEXING_ENABLED", "true"],
  ["PREVIEW_DEMO_ENABLED", "true"],
  ["STRIPE_LIVE_CHECKOUT_ENABLED", "true"],
  ["SUBSCRIPTION_BUYER_ID", "invalid"],
])("rejects unsafe subscription mode %s", (k, v) => {
  environment();
  vi.stubEnv(k, v);
  expect(localSubscriptionIntegration).toThrow("Invalid local subscription");
});
it("only permits necessary local browser routes", () => {
  for (const p of [
    "/account",
    "/plans",
    "/api/auth",
    "/api/billing",
    "/api/diagnoses",
    "/api/consultations",
  ])
    expect(subscriptionRequestAllowed("GET", p)).toBe(true);
  for (const p of ["/api/auth", "/api/billing", "/api/webhooks/stripe"])
    expect(subscriptionRequestAllowed("POST", p)).toBe(true);
  for (const [method, p] of [
    ["POST", "/api/consultations"],
    ["POST", "/api/events"],
    ["POST", "/api/diagnoses/x/checkout"],
    ["POST", "/api/diagnoses/x/report"],
    ["GET", "/api/cron/reports"],
    ["GET", "/auth/callback"],
    ["DELETE", "/api/billing"],
    ["GET", "/_next/image"],
  ])
    expect(subscriptionRequestAllowed(method, p)).toBe(false);
});
it("requires restricted test keys and never retries Stripe writes", () => {
  environment();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_synthetic");
  expect(stripe).toThrow("restricted Sandbox key");
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_synthetic");
  expect(stripe().getMaxNetworkRetries()).toBe(0);
});
it("blocks AI at both entry points before any provider call", async () => {
  environment();
  await expect(
    runAI("synthetic", "paid_report", "fixture", z.string(), {}),
  ).rejects.toThrow("AI generation is disabled");
  await expect(generatePaid("synthetic")).rejects.toThrow(
    "AI generation is disabled",
  );
});
