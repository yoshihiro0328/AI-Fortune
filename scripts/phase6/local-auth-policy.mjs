// Read-only STEP 6 harness; not an application feature or a future mail runner.
export const origin = "https://ukdzggjfkcwjssjmnqim.supabase.co";
export const reads = new Set([
  "/auth/v1/settings",
  "/auth/v1/user",
  ...[
    "diagnosis_types",
    "diagnosis_questions",
    "price_versions",
    "service_settings",
    "payment_environment",
    "diagnoses",
  ].map((t) => "/rest/v1/" + t),
]);
export function allowedExternal(url, method = "GET") {
  try {
    const u = new URL(url);
    return (
      u.origin === origin &&
      !u.username &&
      !u.password &&
      !u.hash &&
      ["GET", "HEAD"].includes(method) &&
      reads.has(u.pathname)
    );
  } catch {
    return false;
  }
}
export function allowedIncoming(path, method, host) {
  return (
    ["localhost:5198", "127.0.0.1:5198"].includes(host) &&
    ["GET", "HEAD"].includes(method) &&
    !/^\/(auth|api\/cron|_next\/image)(\/|$)/.test(path)
  );
}
export function validateRuntime(env) {
  if (
    env.NEXT_PUBLIC_SUPABASE_URL !== origin ||
    env.NEXT_PUBLIC_APP_URL !== "http://localhost:5198" ||
    env.STRIPE_MODE !== "sandbox"
  )
    throw new Error("Invalid isolated target");
  for (const k of [
    "TRIAL_ENABLED",
    "TRIAL_RETENTION_VERIFIED",
    "TRIAL_BUDGET_VERIFIED",
    "STRIPE_LIVE_CHECKOUT_ENABLED",
    "PREVIEW_DEMO_ENABLED",
    "PUBLIC_INDEXING_ENABLED",
  ])
    if (env[k] !== "false") throw new Error("Unsafe runtime flags");
  for (const [k, v] of Object.entries(env))
    if (v && /OPENAI|WEBHOOK|STRIPE.*(SECRET|KEY)|VERCEL/.test(k))
      throw new Error("Forbidden credential or deployment setting");
  for (const [name, role] of [
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"],
    ["SUPABASE_SERVICE_ROLE_KEY", "service_role"],
  ]) {
    let jwt;
    try {
      jwt = JSON.parse(
        Buffer.from(env[name].split(".")[1], "base64url").toString(),
      );
    } catch {
      throw new Error("Invalid dedicated key");
    }
    if (jwt.ref !== "ukdzggjfkcwjssjmnqim" || jwt.role !== role)
      throw new Error("Wrong dedicated key");
  }
  if (!/^[0-9a-f]{64}$/.test(env.SESSION_SECRET ?? ""))
    throw new Error("Missing dedicated session secret");
}
