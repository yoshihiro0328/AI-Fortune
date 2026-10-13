import "server-only";
import type Stripe from "stripe";
import { stripe } from "./client";
import { assertStripeMode, type StripeMode } from "./mode";
export async function assertCheckoutPrice(
  session: Stripe.Checkout.Session,
  price: Stripe.Price,
  mode: StripeMode,
  kind: "payment" | "subscription",
) {
  assertStripeMode(session, mode);
  if (
    session.mode !== kind ||
    session.amount_total !== price.unit_amount ||
    session.currency !== "jpy"
  )
    throw new Error("Checkout total mismatch");
  const lines = await stripe().checkout.sessions.listLineItems(session.id, {
    limit: 2,
  });
  const line = lines.data[0];
  if (
    lines.has_more ||
    lines.data.length !== 1 ||
    line?.price?.id !== price.id ||
    line.quantity !== 1 ||
    line.amount_total !== price.unit_amount
  )
    throw new Error("Checkout price mismatch");
  assertStripeMode(line.price, mode);
}
