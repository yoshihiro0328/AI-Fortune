// Explicit, local-only payment verification. This is not an entitlement bypass.
export function localPaymentIntegration(): boolean {
  const flag = process.env.PAYMENT_INTEGRATION_LOCAL;
  if (flag === undefined || flag === "false") return false;
  const disabled = [
    "TRIAL_ENABLED",
    "TRIAL_RETENTION_VERIFIED",
    "TRIAL_BUDGET_VERIFIED",
    "PREVIEW_DEMO_ENABLED",
    "PUBLIC_INDEXING_ENABLED",
    "STRIPE_LIVE_CHECKOUT_ENABLED",
  ];
  if (
    flag !== "true" ||
    !["development", "test"].includes(process.env.NODE_ENV ?? "") ||
    process.env.VERCEL !== undefined ||
    process.env.VERCEL_ENV !== undefined ||
    process.env.VERCEL_PROJECT_ID !== undefined ||
    process.env.NEXT_PUBLIC_APP_URL !== "http://localhost:5208" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !==
      "https://ukdzggjfkcwjssjmnqim.supabase.co" ||
    process.env.STRIPE_ACCOUNT_ID !== "acct_1UQlQdI73kTcvXz8" ||
    process.env.STRIPE_MODE !== "sandbox" ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_GATEWAY_API_KEY ||
    disabled.some((name) => process.env[name] !== "false") ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      process.env.PAYMENT_INTEGRATION_DIAGNOSIS_ID ?? "",
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      process.env.PAYMENT_INTEGRATION_BUYER_ID ?? "",
    )
  )
    throw new Error("Invalid local payment integration configuration");
  return true;
}

export function assertIntegrationDiagnosis(id: string) {
  if (
    localPaymentIntegration() &&
    id !== process.env.PAYMENT_INTEGRATION_DIAGNOSIS_ID
  )
    throw new Error("Outside the approved payment fixture");
}

export function paymentIntegrationRequestAllowed(method: string, path: string) {
  const id = process.env.PAYMENT_INTEGRATION_DIAGNOSIS_ID;
  if (method === "POST")
    return (
      path === "/api/auth" ||
      path === "/api/webhooks/stripe" ||
      path === `/api/diagnoses/${id}/checkout`
    );
  if (!["GET", "HEAD"].includes(method)) return false;
  if (path === "/api/auth" || path === "/api/diagnoses") return true;
  if (path.startsWith("/api/"))
    return (
      path === `/api/diagnoses/${id}` || path === `/api/diagnoses/${id}/report`
    );
  return (
    path === "/account" ||
    path === `/result/${id}` ||
    path === `/report/${id}` ||
    path.startsWith("/_next/static/") ||
    path === "/_next/webpack-hmr" ||
    path === "/icon.svg" ||
    path === "/favicon.ico"
  );
}
