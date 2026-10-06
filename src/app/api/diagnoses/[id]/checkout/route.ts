import { api, csrf, owned, rate, event, HttpError } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { lock } from "@/lib/ai/pipeline";
import { required, appUrl } from "@/lib/config";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    csrf(req);
    const { id } = await params;
    const d = await owned(id);
    await rate("checkout:" + id, 15, 3600);
    if (d.status === "safety" || d.classification_json?.risk_detected)
      throw new HttpError(403, "この相談は安全確保を優先します。");
    if (
      !checked(
        await db()
          .from("free_reports")
          .select("id")
          .eq("diagnosis_id", id)
          .maybeSingle(),
      )
    )
      throw new HttpError(409, "先に無料診断を完了してください。");
    return lock("checkout:" + id, async () => {
      const s = stripe();
      const price = await s.prices.retrieve(
        required("STRIPE_PAID_DIAGNOSIS_PRICE_ID"),
      );
      if (
        price.livemode ||
        !price.active ||
        price.unit_amount !== 1980 ||
        price.currency !== "jpy" ||
        price.type !== "one_time"
      )
        throw new Error("Invalid price");
      let p = checked(
        await db()
          .from("payments")
          .select("*")
          .eq("diagnosis_id", id)
          .maybeSingle(),
      );
      if (!p)
        p = checked(
          await db()
            .from("payments")
            .insert({ diagnosis_id: id, user_id: d.user_id })
            .select("*")
            .single(),
        );
      if (p.status === "paid") return { url: appUrl() + "/report/" + id };
      if (p.status === "refunded")
        throw new HttpError(
          409,
          "返金済みです。この診断の再購入はできません。",
        );
      if (p.stripe_checkout_session_id) {
        const previous = await s.checkout.sessions.retrieve(
          p.stripe_checkout_session_id,
        );
        if (previous.status === "open" && previous.url)
          return { url: previous.url };
        if (previous.status === "complete")
          throw new HttpError(
            409,
            "決済を確認しています。結果画面でお待ちください。",
          );
      }
      const session = await s.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ price: price.id, quantity: 1 }],
          client_reference_id: id,
          metadata: { payment_id: p.id, diagnosis_id: id },
          payment_intent_data: {
            metadata: { payment_id: p.id, diagnosis_id: id },
          },
          success_url: appUrl() + "/report/" + id + "?checkout=complete",
          cancel_url: appUrl() + "/result/" + id,
          integration_identifier: "yorisoi-mvp-qkzmdvpa",
        },
        {
          idempotencyKey:
            "checkout:" +
            p.id +
            ":" +
            (p.stripe_checkout_session_id ?? "initial"),
        },
      );
      if (session.livemode || !session.url) throw new Error("Invalid checkout");
      checked(
        await db()
          .from("payments")
          .update({
            stripe_checkout_session_id: session.id,
            status: "pending",
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.id)
          .in("status", ["pending", "failed"]),
      );
      await event("checkout_started", id);
      return { url: session.url };
    });
  });
}
