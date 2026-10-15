/** Server configuration only; never infer demo access from a cookie or request. */
export const REVIEW_PROJECT_ID = "prj_oBNCS3yHBdYmvCuSKC4pnhcoypp6";
export function demoEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env.PREVIEW_DEMO_ENABLED === "true" &&
    env.VERCEL_ENV === "preview" &&
    env.VERCEL_TARGET_ENV !== "production" &&
    env.VERCEL_PROJECT_ID === REVIEW_PROJECT_ID
  );
}

/** The review project must never reach real APIs, even if the demo flag is lost. */
export function isolatedReviewProject(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VERCEL_PROJECT_ID === REVIEW_PROJECT_ID;
}
