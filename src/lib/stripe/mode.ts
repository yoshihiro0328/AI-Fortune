export type StripeMode = "sandbox" | "live";
export function stripeMode(): StripeMode {
  const mode = process.env.STRIPE_MODE;
  const target = process.env.VERCEL_ENV;
  if (
    target !== undefined &&
    !["preview", "development", "production"].includes(target)
  )
    throw new Error("Unknown execution environment");
  if (mode !== "sandbox" && mode !== "live")
    throw new Error("Stripe mode must be explicit");
  if (mode === "live" && process.env.VERCEL_ENV !== "production")
    throw new Error("Live Stripe requires Production");
  if (mode === "sandbox" && process.env.VERCEL_ENV === "production")
    throw new Error("Sandbox Stripe cannot use Production");
  return mode;
}
export function assertStripeMode(
  object: { livemode?: boolean },
  mode = stripeMode(),
) {
  if (object.livemode !== (mode === "live"))
    throw new Error("Stripe environment mismatch");
}
export function assertCheckoutEnabled() {
  if (
    stripeMode() === "live" &&
    process.env.STRIPE_LIVE_CHECKOUT_ENABLED !== "true"
  )
    throw new Error("Live checkout is not enabled");
}
