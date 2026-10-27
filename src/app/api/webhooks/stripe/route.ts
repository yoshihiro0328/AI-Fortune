import { safeOperationalLog } from "@/lib/production/log";
import { localSubscriptionIntegration } from "@/lib/stripe/local-subscription";
import {
  localPaymentIntegration,
  assertIntegrationDiagnosis,
} from "@/lib/stripe/local-integration";
import { boundedText, HttpError } from "@/lib/http";
import { createHash } from "node:crypto";
import { after } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { reportEvent } from "@/lib/stripe/report-event";
import { stripeEnvironment } from "@/lib/stripe/environment";
import { assertStripeMode, stripeMode } from "@/lib/stripe/mode";
import { required } from "@/lib/config";
import { db, checked } from "@/lib/supabase/admin";
import { generatePaid } from "@/lib/ai/pipeline";
import {
  subscriptionFromEvent,
  syncSubscription,
} from "@/lib/stripe/subscriptions";
export const maxDuration = 300;
export async function POST(req: Request) {
  let raw: string;
  try {
    raw = await boundedText(req, 300000);
  } catch (e) {
    return Response.json(
      { error: "Invalid request" },
      { status: e instanceof HttpError ? e.status : 400 },
    );
  }
  let e: Stripe.Event;
  try {
    e = stripe().webhooks.constructEvent(
      raw,
      req.headers.get("stripe-signature") ?? "",
      required("STRIPE_WEBHOOK_SECRET"),
    );
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    assertStripeMode(e);
    assertStripeMode(e.data.object as { livemode?: boolean });
    if (!/^evt_[A-Za-z0-9_]+$/.test(e.id)) throw new Error("Invalid event");
  } catch {
    return Response.json({ error: "Environment mismatch" }, { status: 400 });
  }
  try {
    const local = localPaymentIntegration();
    if (localSubscriptionIntegration()) {
      if (
        ![
          "checkout.session.completed",
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
          "invoice.paid",
          "invoice.payment_failed",
        ].includes(e.type)
      )
        throw Error("Outside subscription test");
      const object = e.data.object as unknown as {
        customer?: string;
        mode?: string;
      };
      if (
        object.customer !== process.env.SUBSCRIPTION_CUSTOMER_ID ||
        (e.type === "checkout.session.completed" &&
          object.mode !== "subscription")
      )
        throw Error("Outside subscription customer");
    }
    const environment = await stripeEnvironment();
    if (e.account && e.account !== environment.stripe_account_id)
      throw new Error("Webhook account mismatch");
    if (
      local &&
      ![
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(e.type)
    )
      throw new Error("Event outside the approved local test");
    if (local && (e.data.object as Stripe.Checkout.Session).mode !== "payment")
      throw new Error("Subscription outside the approved local test");
    const subscription = await subscriptionFromEvent(e);
    if (subscription) {
      await syncSubscription(subscription, {
        id: e.id,
        type: e.type,
        hash: createHash("sha256").update(raw).digest("hex"),
      });
      return Response.json({ received: true });
    }
    const purchase = await reportEvent(e, stripeMode());
    if (!purchase) return Response.json({ received: true });
    const { session, intent, payment, amount, currency, state, diagnosis } =
      purchase;
    if (diagnosis) assertIntegrationDiagnosis(diagnosis);
    checked(
      await db().rpc("apply_stripe_event_v2", {
        p_event: e.id,
        p_type: e.type,
        p_hash: createHash("sha256").update(raw).digest("hex"),
        p_session: session,
        p_intent: intent,
        p_payment: payment,
        p_amount: amount,
        p_currency: currency,
        p_state: state,
        p_is_test: stripeMode() === "sandbox",
        p_customer: purchase.customer,
      }),
    );
    if (state === "paid" && diagnosis && !local)
      after(async () => {
        try {
          await generatePaid(diagnosis!);
        } catch {
          safeOperationalLog("paid_report_failed");
        }
      });
    return Response.json({ received: true });
  } catch {
    safeOperationalLog("webhook_processing_failed");
    return Response.json({ error: "Retry required" }, { status: 500 });
  }
}
