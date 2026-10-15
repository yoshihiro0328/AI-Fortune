/** Offline preparation only: no network, credentials, mail, or approval inference. */
export const AUTH_TEST_PROJECT = "ukdzggjfkcwjssjmnqim";

// The legacy admin.generateLink fixture is NOT a real email verification test.
// It must never use .env.local or a hosted Supabase project.
export function assertLocalAuthFixture(env) {
  const stop = () => {
    throw new Error(
      "Auth fixture blocked: isolated local targets and explicit local opt-in required",
    );
  };
  if (
    env.AUTH_FIXTURE_LOCAL_ONLY !== "true" ||
    env.VERCEL ||
    env.VERCEL_ENV ||
    env.NODE_ENV === "production"
  )
    stop();
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "TEST_BASE_URL"]) {
    let url;
    try {
      url = new URL(env[name]);
    } catch {
      stop();
    }
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      stop();
  }
}

/** Validate a proposed schedule, not actual delivery. Reserve failed/unknown attempts too.
 * Execution must use a persisted, single-writer project-wide ledger; never reset it on retry.
 * Email addresses stay outside this module: only recipient labels A/B are accepted.
 */
export function checkAuthMailPlan(plan) {
  if (plan.projectRef !== AUTH_TEST_PROJECT)
    throw new Error("Wrong Auth project");
  if (
    !Array.isArray(plan.attempts) ||
    plan.attempts.length < 1 ||
    plan.attempts.length > 4
  )
    throw new Error("Initial mail budget is 1..4 attempts");
  const prior = [];
  for (const attempt of plan.attempts) {
    if (
      !["A", "B"].includes(attempt.recipient) ||
      !["signup", "resend"].includes(attempt.action)
    )
      throw new Error("Unapproved recipient/action");
    const at = attempt.atMs;
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      (prior.length && at < prior.at(-1).atMs)
    )
      throw new Error("Invalid schedule");
    // Conservative rolling window, including the exact hour boundary.
    if (prior.filter((p) => at - p.atMs <= 3600000).length >= 2)
      throw new Error("Project email rate limit");
    if (
      prior.some(
        (p) => p.recipient === attempt.recipient && at - p.atMs < 60000,
      )
    )
      throw new Error("Recipient email cooldown");
    prior.push(attempt);
  }
  return {
    attempts: prior.length,
    approvalRequired: true,
    deliveryVerified: false,
  };
}
