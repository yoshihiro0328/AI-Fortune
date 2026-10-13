import { stripeEnvironment } from "./environment";
import { assertStripeMode } from "./mode";
import "server-only";
import type Stripe from "stripe";
import { stripe } from "./client";
import { db, checked } from "@/lib/supabase/admin";
import { lock } from "@/lib/ai/pipeline";
export const stripeId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
export async function syncSubscription(
  id: string,
  event?: { id: string; type: string; hash: string },
) {
  return lock("stripe-subscription:" + id, async () => {
    const environment = await stripeEnvironment();
    const s = await stripe().subscriptions.retrieve(id, {
      expand: ["latest_invoice"],
    });
    assertStripeMode(s, environment.mode);
    const customer = stripeId(s.customer);
    const binding = checked(
      await db()
        .from("billing_customers")
        .select("user_id,is_test")
        .eq("stripe_customer_id", customer!)
        .maybeSingle(),
    );
    if (!binding) return false; // Unrelated sandbox product/customer is never attached by client metadata.
    if (
      binding.is_test !== environment.isTest ||
      (s.metadata.user_id && s.metadata.user_id !== binding.user_id)
    )
      throw new Error("Customer environment mismatch");
    const item = s.items.data[0];
    if (s.items.data.length !== 1 || !item)
      throw new Error("Unexpected subscription items");
    const version = checked(
      await db()
        .from("price_versions")
        .select("*")
        .eq("kind", "plus")
        .eq("stripe_price_id", item.price.id)
        .maybeSingle(),
    );
    if (
      !version ||
      item.quantity !== 1 ||
      item.price.currency !== "jpy" ||
      item.price.unit_amount !== version.amount ||
      version.is_test !== environment.isTest ||
      item.price.livemode !== (environment.mode === "live") ||
      item.price.product !== version.stripe_product_id ||
      item.price.recurring?.interval !== "month" ||
      item.price.recurring.interval_count !== 1
    )
      throw new Error("Subscription price mismatch");
    const invoices = await stripe().invoices.list({
      subscription: s.id,
      limit: 24,
    });
    const rows = invoices.data.map((i) => {
      const line = i.lines.data.find(
        (l) => l.pricing?.price_details?.price === item.price.id,
      );
      assertStripeMode(i, environment.mode);
      if (
        stripeId(i.customer) !== customer ||
        stripeId(i.parent?.subscription_details?.subscription) !== s.id ||
        i.currency !== "jpy" ||
        !line ||
        i.lines.has_more ||
        i.lines.data.length !== 1 ||
        line.quantity !== 1 ||
        (i.status === "paid" &&
          (i.amount_paid !== version.amount || i.total !== version.amount))
      )
        throw new Error("Invoice mismatch");
      return {
        id: i.id,
        subscription_id: s.id,
        user_id: binding.user_id,
        amount: i.amount_paid,
        status: i.status ?? "draft",
        currency: i.currency,
        paid_at: i.status_transitions.paid_at
          ? iso(i.status_transitions.paid_at)
          : null,
        period_start: iso(line?.period.start ?? i.period_start),
        period_end: iso(line?.period.end ?? i.period_end),
        is_test: environment.isTest,
        created_at: iso(i.created),
      };
    });
    const paid = rows
      .filter(
        (i) =>
          i.status === "paid" &&
          i.amount === version.amount &&
          i.currency === "jpy",
      )
      .sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
    const snapshot = {
      id: s.id,
      user_id: binding.user_id,
      stripe_customer_id: customer,
      price_version: version.id,
      amount: version.amount,
      status: s.status,
      period_start: iso(item.current_period_start),
      period_end: iso(item.current_period_end),
      paid_through: paid?.period_end ?? null,
      cancellation_reason:
        s.cancellation_details?.feedback ??
        s.cancellation_details?.reason ??
        null,
      canceled_at: s.canceled_at ? iso(s.canceled_at) : null,
      cancel_at_period_end: s.cancel_at_period_end || !!s.cancel_at,
      cancel_at: s.cancel_at ? iso(s.cancel_at) : null,
      is_test: environment.isTest,
      created_at: iso(s.created),
      updated_at: new Date().toISOString(),
    };
    checked(
      await db().rpc("apply_subscription_snapshot", {
        p_snapshot: snapshot,
        p_invoices: rows,
        p_event: event?.id ?? null,
        p_type: event?.type ?? null,
        p_hash: event?.hash ?? null,
      }),
    );
    return true;
  });
}
export async function subscriptionFromEvent(
  e: Stripe.Event,
): Promise<string | null> {
  if (
    [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(e.type)
  )
    return (e.data.object as Stripe.Subscription).id;
  if (["invoice.paid", "invoice.payment_failed"].includes(e.type))
    return stripeId(
      (e.data.object as Stripe.Invoice).parent?.subscription_details
        ?.subscription,
    );
  if (e.type === "checkout.session.completed") {
    const s = e.data.object as Stripe.Checkout.Session;
    if (s.mode === "subscription") return stripeId(s.subscription);
  }
  return null;
}
