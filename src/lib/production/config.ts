export function productionRuntime(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === "production" || env.APP_RUNTIME === "production";
}
export class ProductionStop extends Error {
  constructor() {
    super("Production operation unavailable");
    this.name = "ProductionStop";
  }
}
function dataTargetIssues(env: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  if (env.VERCEL_ENV !== "production") issues.push("RUNTIME_TARGET");
  const ref = env.PRODUCTION_SUPABASE_REF;
  if (
    !/^[a-z]{20}$/.test(ref ?? "") ||
    env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`
  )
    issues.push("DATABASE_BINDING");
  return issues;
}
// Keep reads/cancellation available when only AI or sales are disabled, but never
// construct a data/auth client for a mismatched production database target.
export function assertProductionDataTarget(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (productionRuntime(env) && dataTargetIssues(env).length)
    throw new ProductionStop();
}
// Only fixed issue codes leave this validator. Never return configuration values.
export function productionIssues(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const issues: string[] = [];
  issues.push(...dataTargetIssues(env));
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(env.PRODUCTION_ENVIRONMENT_ID ?? ""))
    issues.push("ENVIRONMENT_BINDING");
  try {
    const u = new URL(env.NEXT_PUBLIC_APP_URL ?? "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      u.hostname === "localhost" ||
      u.origin !== env.PRODUCTION_PUBLIC_ORIGIN ||
      u.port !== ""
    )
      issues.push("PUBLIC_ORIGIN");
  } catch {
    issues.push("PUBLIC_ORIGIN");
  }
  if (
    !/^prj_[A-Za-z0-9]+$/.test(env.PRODUCTION_VERCEL_PROJECT_ID ?? "") ||
    env.VERCEL_PROJECT_ID !== env.PRODUCTION_VERCEL_PROJECT_ID
  )
    issues.push("HOSTING_PROJECT_BINDING");
  if (
    env.OPENAI_MODEL !== "gpt-6-luna" ||
    (env.OPENAI_CHAT_MODEL && env.OPENAI_CHAT_MODEL !== "gpt-6-luna")
  )
    issues.push("MODEL_BINDING");
  if (!/^proj_[A-Za-z0-9_-]+$/.test(env.PRODUCTION_OPENAI_PROJECT_ID ?? ""))
    issues.push("AI_PROJECT_BINDING");
  if (env.OPENAI_BASE_URL || env.OPENAI_ORG_ID || env.OPENAI_PROJECT_ID)
    issues.push("AI_OVERRIDE");
  if (
    env.STRIPE_MODE !== "live" ||
    !/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_ACCOUNT_ID ?? "") ||
    !/^rk_live_/.test(env.STRIPE_SECRET_KEY ?? "")
  )
    issues.push("PAYMENT_BINDING");
  if (
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !env.OPENAI_API_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.SESSION_SECRET ||
    !env.CRON_SECRET ||
    !env.STRIPE_WEBHOOK_SECRET
  )
    issues.push("REQUIRED_SECRET");
  if (
    env.MAIL_ENABLED === "true" &&
    (!env.RESEND_API_KEY ||
      ["EMAIL_FROM", "EMAIL_REPLY_TO", "CONTACT_NOTIFY_TO"].some(
        (k) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env[k] ?? ""),
      ))
  )
    issues.push("MAIL_CONFIGURATION");
  if (
    [
      "PAYMENT_INTEGRATION_LOCAL",
      "SUBSCRIPTION_INTEGRATION_LOCAL",
      "PREVIEW_DEMO_ENABLED",
      "TRIAL_ENABLED",
    ].some((k) => env[k] === "true" || env[k] === "1")
  )
    issues.push("TEST_FEATURE_ENABLED");
  return issues;
}
export function productionEnvironment() {
  if (productionIssues().length) throw new ProductionStop();
  return process.env.PRODUCTION_ENVIRONMENT_ID!;
}
