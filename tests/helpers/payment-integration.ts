import { vi } from "vitest";
export const paymentFixtureDiagnosis = "00000000-0000-4000-8000-000000000002";
export function localPaymentEnv() {
  for (const name of [
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_PROJECT_ID",
    "OPENAI_API_KEY",
    "AI_GATEWAY_API_KEY",
  ])
    vi.stubEnv(name, undefined);
  for (const name of [
    "TRIAL_ENABLED",
    "TRIAL_RETENTION_VERIFIED",
    "TRIAL_BUDGET_VERIFIED",
    "PREVIEW_DEMO_ENABLED",
    "PUBLIC_INDEXING_ENABLED",
    "STRIPE_LIVE_CHECKOUT_ENABLED",
  ])
    vi.stubEnv(name, "false");
  vi.stubEnv(
    "PAYMENT_INTEGRATION_BUYER_ID",
    "00000000-0000-4000-8000-000000000001",
  );
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PAYMENT_INTEGRATION_LOCAL", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:5208");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://ukdzggjfkcwjssjmnqim.supabase.co",
  );
  vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_1UQlQdI73kTcvXz8");
  vi.stubEnv("STRIPE_MODE", "sandbox");
  vi.stubEnv("PAYMENT_INTEGRATION_DIAGNOSIS_ID", paymentFixtureDiagnosis);
}
