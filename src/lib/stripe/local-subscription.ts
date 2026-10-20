// Separate from the completed one-off payment fixture; never enabled in deployment.
export function localSubscriptionIntegration() {
  const flag = process.env.SUBSCRIPTION_INTEGRATION_LOCAL;
  if (flag === undefined || flag === "false") return false;
  if (
    flag !== "true" ||
    !["development", "test"].includes(process.env.NODE_ENV ?? "") ||
    process.env.VERCEL !== undefined ||
    process.env.VERCEL_ENV !== undefined ||
    process.env.VERCEL_PROJECT_ID !== undefined ||
    process.env.PAYMENT_INTEGRATION_LOCAL === "true" ||
    process.env.NEXT_PUBLIC_APP_URL !== "http://localhost:5218" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !==
      "https://ukdzggjfkcwjssjmnqim.supabase.co" ||
    process.env.STRIPE_ACCOUNT_ID !== "acct_1UQlQdI73kTcvXz8" ||
    process.env.STRIPE_MODE !== "sandbox" ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_GATEWAY_API_KEY ||
    [
      "TRIAL_ENABLED",
      "TRIAL_RETENTION_VERIFIED",
      "TRIAL_BUDGET_VERIFIED",
      "PREVIEW_DEMO_ENABLED",
      "PUBLIC_INDEXING_ENABLED",
      "STRIPE_LIVE_CHECKOUT_ENABLED",
    ].some((k) => process.env[k] !== "false") ||
    !/^[0-9a-f-]{36}$/.test(process.env.SUBSCRIPTION_BUYER_ID ?? "")
  )
    throw Error("Invalid local subscription configuration");
  return true;
}
export function subscriptionRequestAllowed(method: string, path: string) {
  if (method === "POST")
    return ["/api/auth", "/api/billing", "/api/webhooks/stripe"].includes(path);
  if (!["GET", "HEAD"].includes(method)) return false;
  return (
    [
      "/account",
      "/plans",
      "/api/auth",
      "/api/diagnoses",
      "/api/billing",
      "/api/consultations",
      "/icon.svg",
      "/favicon.ico",
    ].includes(path) ||
    path.startsWith("/_next/static/") ||
    path === "/_next/webpack-hmr"
  );
}
