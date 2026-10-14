import type Stripe from "stripe";
import { stripeMode, type StripeMode } from "./mode";
export function paidSession(
  s: Stripe.Checkout.Session,
  mode: StripeMode = stripeMode(),
) {
  return (
    s.livemode === (mode === "live") &&
    s.mode === "payment" &&
    s.payment_status === "paid" &&
    ((mode === "sandbox" && s.amount_total === 1980) ||
      s.amount_total === 980) &&
    s.currency === "jpy" &&
    !!s.metadata?.payment_id
  );
}
