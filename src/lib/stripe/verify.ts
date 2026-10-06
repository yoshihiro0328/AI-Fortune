import type Stripe from "stripe";
export function paidSession(s: Stripe.Checkout.Session) {
  return (
    !s.livemode &&
    s.mode === "payment" &&
    s.payment_status === "paid" &&
    s.amount_total === 1980 &&
    s.currency === "jpy" &&
    !!s.metadata?.payment_id
  );
}
