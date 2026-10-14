import "server-only";
import type Stripe from "stripe";
import { db, checked } from "@/lib/supabase/admin";
import { stripe } from "./client";
import { assertStripeMode, type StripeMode } from "./mode";
import { stripeId } from "./subscriptions";
// A signed event is still bound to the stored purchase and authoritative Checkout line.
export async function reportEvent(e: Stripe.Event, mode: StripeMode) {
  const s = stripe();
  let intent: string | null, payment: string | null, state: string;
  let session: Stripe.Checkout.Session | undefined;
  if (
    e.type === "checkout.session.completed" ||
    e.type === "checkout.session.async_payment_succeeded"
  ) {
    if (
      e.data.object.mode !== "payment" ||
      e.data.object.payment_status !== "paid"
    )
      return null;
    session = e.data.object;
    payment = session.metadata?.payment_id ?? null;
    intent = stripeId(session.payment_intent);
    state = "paid";
  } else if (e.type === "payment_intent.payment_failed") {
    intent = e.data.object.id;
    payment = e.data.object.metadata.payment_id ?? null;
    state = "failed";
  } else if (e.type === "charge.refunded") {
    intent = stripeId(e.data.object.payment_intent);
    payment = e.data.object.metadata.payment_id ?? null;
    state = "refunded";
  } else return null;
  if (!intent) {
    if (payment) throw new Error("PaymentIntent missing; retry notification");
    return null;
  }
  // Charge metadata may be absent even when its PaymentIntent carries our purchase ID.
  if (!payment && e.type === "charge.refunded") {
    const source = await s.paymentIntents.retrieve(intent);
    assertStripeMode(source, mode);
    payment = source.metadata.payment_id ?? null;
  }
  const p = checked(
    await db()
      .from("payments")
      .select("*")
      .eq(payment ? "id" : "stripe_payment_intent_id", payment ?? intent)
      .maybeSingle(),
  );
  if (!p) {
    if (payment) throw new Error("Unknown purchase");
    return null;
  }
  if (
    p.is_test !== (mode === "sandbox") ||
    (state !== "failed" &&
      p.stripe_payment_intent_id &&
      p.stripe_payment_intent_id !== intent)
  )
    throw new Error("Purchase binding mismatch");
  if (state === "failed" && ["paid", "refunded"].includes(p.status))
    return null;
  const pi = await s.paymentIntents.retrieve(intent);
  assertStripeMode(pi, mode);
  if (
    pi.amount !== p.amount ||
    pi.currency !== p.currency ||
    pi.metadata.payment_id !== p.id ||
    pi.metadata.diagnosis_id !== p.diagnosis_id ||
    (p.stripe_customer_id && p.stripe_customer_id !== stripeId(pi.customer))
  )
    throw new Error("Intent binding mismatch");
  // The webhook can beat the local persistence after Checkout creation.
  let checkoutId = p.stripe_checkout_session_id ?? session?.id;
  if (!checkoutId) {
    const matches = await s.checkout.sessions.list({
      payment_intent: intent,
      limit: 2,
    });
    if (matches.has_more || matches.data.length > 1)
      throw new Error("Ambiguous checkout");
    checkoutId = matches.data[0]?.id;
  }
  if (!checkoutId) {
    if (state !== "failed")
      throw new Error("Checkout not available; retry notification");
    // A verified failure may be recorded without a session. It grants no access and pins no intent.
    return {
      payment: p.id,
      diagnosis: p.diagnosis_id,
      session: null,
      intent,
      amount: p.amount,
      currency: p.currency,
      customer: stripeId(pi.customer),
      state,
    };
  }
  const checkout = await s.checkout.sessions.retrieve(checkoutId);
  assertStripeMode(checkout, mode);
  // An older failed attempt must not change a newer Checkout attempt.
  if (
    state === "failed" &&
    stripeId(checkout.payment_intent) &&
    stripeId(checkout.payment_intent) !== intent
  )
    return null;
  if (stripeId(pi.customer) !== stripeId(checkout.customer))
    throw new Error("Customer binding mismatch");
  if (session && session.id !== checkout.id)
    throw new Error("Checkout binding mismatch");
  if (
    checkout.mode !== "payment" ||
    checkout.metadata?.payment_id !== p.id ||
    checkout.metadata?.diagnosis_id !== p.diagnosis_id ||
    checkout.client_reference_id !== p.diagnosis_id ||
    checkout.currency !== p.currency ||
    checkout.amount_total !== p.amount ||
    (stripeId(checkout.payment_intent) &&
      stripeId(checkout.payment_intent) !== intent) ||
    (p.stripe_customer_id &&
      p.stripe_customer_id !== stripeId(checkout.customer))
  )
    throw new Error("Checkout purchase mismatch");
  const lines = await s.checkout.sessions.listLineItems(checkout.id, {
    limit: 2,
  });
  const line = lines.data[0];
  if (
    lines.has_more ||
    lines.data.length !== 1 ||
    !line?.price ||
    line.quantity !== 1 ||
    line.amount_total !== p.amount ||
    line.currency !== p.currency ||
    line.price.type !== "one_time" ||
    line.price.unit_amount !== p.amount ||
    line.price.currency !== p.currency
  )
    throw new Error("Checkout line mismatch");
  assertStripeMode(line.price, mode);
  if (p.price_version) {
    const v = checked(
      await db()
        .from("price_versions")
        .select("*")
        .eq("id", p.price_version)
        .single(),
    );
    if (
      v.is_test !== p.is_test ||
      v.stripe_price_id !== line.price.id ||
      v.stripe_product_id !== line.price.product ||
      v.amount !== p.amount ||
      v.kind !== "report"
    )
      throw new Error("Purchased price mismatch");
  } else if (mode !== "sandbox" || ![980, 1980].includes(p.amount))
    throw new Error("Legacy purchase is Sandbox only");
  if (
    state === "paid" &&
    (checkout.payment_status !== "paid" ||
      pi.status !== "succeeded" ||
      pi.amount_received !== p.amount)
  )
    throw new Error("Payment not settled");
  if (e.type === "charge.refunded") {
    const c = e.data.object;
    assertStripeMode(c, mode);
    if (
      c.amount !== p.amount ||
      c.currency !== p.currency ||
      stripeId(c.customer) !== stripeId(checkout.customer) ||
      c.amount_refunded <= 0
    )
      throw new Error("Refund mismatch");
  }
  return {
    payment: p.id,
    diagnosis: p.diagnosis_id,
    session: checkout.id,
    intent,
    amount: p.amount,
    currency: p.currency,
    customer: stripeId(checkout.customer),
    state,
  };
}
