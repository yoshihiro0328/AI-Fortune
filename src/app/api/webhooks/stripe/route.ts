import { boundedText, HttpError } from "@/lib/http";
import { createHash } from "node:crypto";
import { after } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { paidSession } from "@/lib/stripe/verify";
import { required } from "@/lib/config";
import { db, checked } from "@/lib/supabase/admin";
import { generatePaid } from "@/lib/ai/pipeline";
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
  if (e.livemode)
    return Response.json({ error: "Live mode disabled" }, { status: 400 });
  try {
    let session: string | null = null,
      intent: string | null = null,
      payment: string | null = null,
      amount = 0,
      currency = "jpy",
      state = "",
      diagnosis: string | null = null;
    if (
      e.type === "checkout.session.completed" ||
      e.type === "checkout.session.async_payment_succeeded"
    ) {
      const s = e.data.object;
      if (!paidSession(s))
        return Response.json({ received: true, fulfilled: false });
      session = s.id;
      intent =
        typeof s.payment_intent === "string"
          ? s.payment_intent
          : (s.payment_intent?.id ?? null);
      payment = s.metadata!.payment_id;
      diagnosis = s.metadata!.diagnosis_id;
      amount = s.amount_total!;
      currency = s.currency!;
      state = "paid";
    } else if (e.type === "payment_intent.payment_failed") {
      const p = e.data.object;
      intent = p.id;
      payment = p.metadata.payment_id ?? null;
      state = "failed";
    } else if (e.type === "charge.refunded") {
      const c = e.data.object;
      intent =
        typeof c.payment_intent === "string"
          ? c.payment_intent
          : (c.payment_intent?.id ?? null);
      payment = c.metadata.payment_id ?? null;
      state = "refunded";
    } else return Response.json({ received: true });
    if (!payment && !intent) return Response.json({ received: true });
    checked(
      await db().rpc("apply_stripe_event", {
        p_event: e.id,
        p_type: e.type,
        p_hash: createHash("sha256").update(raw).digest("hex"),
        p_session: session,
        p_intent: intent,
        p_payment: payment,
        p_amount: amount,
        p_currency: currency,
        p_state: state,
      }),
    );
    if (state === "paid" && diagnosis)
      after(async () => {
        try {
          await generatePaid(diagnosis!);
        } catch {
          console.error("paid_report_failed", { diagnosis_id: diagnosis });
        }
      });
    return Response.json({ received: true });
  } catch {
    console.error("webhook_processing_failed", { event_id: e.id });
    return Response.json({ error: "Retry required" }, { status: 500 });
  }
}
