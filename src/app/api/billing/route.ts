import { z } from "zod";
import { exchangeExplanation } from "@/lib/display-copy";
import { api, body, csrf, HttpError, rate, event } from "@/lib/http";
import { member } from "@/lib/consultation/access";
import { db, checked } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe/client";
import { offer } from "@/lib/stripe/catalog";
import { serviceSettings } from "@/lib/service-settings";
import { lock } from "@/lib/ai/pipeline";
import { appUrl } from "@/lib/config";
import { syncSubscription } from "@/lib/stripe/subscriptions";
export async function GET() {
  return api(async () => {
    const user = await member();
    await rate("billing-read:" + user, 60, 3600);
    const customer = checked(
      await db()
        .from("billing_customers")
        .select("stripe_customer_id")
        .eq("user_id", user)
        .maybeSingle(),
    );
    if (customer) {
      const subs = await stripe().subscriptions.list({
        customer: customer.stripe_customer_id,
        status: "all",
        limit: 10,
      });
      for (const sub of subs.data) await syncSubscription(sub.id);
    }
    return {
      subscription: checked(
        await db()
          .from("subscriptions")
          .select(
            "id,amount,status,period_end,paid_through,cancel_at_period_end,cancel_at",
          )
          .eq("user_id", user)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
      invoices: checked(
        await db()
          .from("subscription_invoices")
          .select("id,amount,status,paid_at,period_start,period_end,is_test")
          .eq("user_id", user)
          .order("created_at", { ascending: false })
          .limit(24),
      ),
      usage: checked(
        await db().rpc("consultation_entitlement", { p_user: user }),
      ),
    };
  });
}
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    const user = await member();
    const input = await body(
      req,
      z.object({
        action: z.enum(["checkout", "portal", "cancel"]),
        consent: z.boolean().optional(),
      }),
    );
    await rate("billing:" + user, 20, 3600);
    return lock("billing:" + user, async () => {
      const s = stripe();
      let customer = checked(
        await db()
          .from("billing_customers")
          .select("*")
          .eq("user_id", user)
          .maybeSingle(),
      );
      if (input.action !== "checkout") {
        if (!customer) throw new HttpError(404, "契約が見つかりません。");
        if (input.action === "cancel") {
          const current = await s.subscriptions.list({
            customer: customer.stripe_customer_id,
            status: "all",
            limit: 100,
          });
          const known = checked(
            await db().from("subscriptions").select("id").eq("user_id", user),
          );
          for (const sub of current.data.filter(
            (v) =>
              known?.some((k) => k.id === v.id) &&
              ["active", "past_due", "unpaid"].includes(v.status),
          )) {
            await s.subscriptions.update(sub.id, {
              cancel_at_period_end: true,
            });
            await syncSubscription(sub.id);
          }
          return { ok: true };
        }
        const settings = checked(
          await db()
            .from("service_settings")
            .select("portal_configuration_id")
            .single(),
        );
        if (!settings?.portal_configuration_id)
          throw new Error("Portal not configured");
        const portal = await s.billingPortal.sessions.create({
          customer: customer.stripe_customer_id,
          configuration: settings.portal_configuration_id,
          return_url: appUrl() + "/account",
        });
        return { url: portal.url };
      }
      if (!input.consent)
        throw new HttpError(
          400,
          "月額料金と自動更新・解約方法をご確認ください。",
        );
      const { price, row } = await offer("plus");
      const limits = await serviceSettings();
      if (!customer) {
        const c = await s.customers.create(
          { metadata: { app: "yorisoi", user_id: user } },
          { idempotencyKey: "yorisoi-customer:" + user },
        );
        if (c.livemode) throw new Error("Live customer disabled");
        customer = checked(
          await db()
            .from("billing_customers")
            .insert({ user_id: user, stripe_customer_id: c.id })
            .select("*")
            .single(),
        );
      }
      const current = await s.subscriptions.list({
        customer: customer.stripe_customer_id,
        status: "all",
        limit: 100,
      });
      if (
        current.data.some(
          (sub) => !["canceled", "incomplete_expired"].includes(sub.status),
        )
      )
        throw new HttpError(
          409,
          "契約中、または支払い手続き中です。マイページの支払い管理をご確認ください。",
        );
      if (customer.checkout_session_id) {
        const previous = await s.checkout.sessions.retrieve(
          customer.checkout_session_id,
        );
        if (previous.status === "open" && previous.url)
          return { url: previous.url };
      }
      const session = await s.checkout.sessions.create(
        {
          mode: "subscription",
          custom_text: {
            submit: {
              message: `AIとのやり取りは契約期間ごとに${limits.plus_limit}往復まで。${exchangeExplanation}詳細診断は別料金です。現在はテスト決済のみで実請求は発生しません。`,
            },
          },
          customer: customer.stripe_customer_id,
          line_items: [{ price: price.id, quantity: 1 }],
          subscription_data: {
            metadata: { app: "yorisoi", user_id: user, price_version: row.id },
          },
          metadata: { app: "yorisoi", user_id: user, kind: "plus" },
          success_url: appUrl() + "/account?subscription=complete",
          cancel_url: appUrl() + "/plans",
          integration_identifier: "yorisoi-mvp-qkzmdvpa",
        },
        {
          idempotencyKey:
            "plus:" + user + ":" + (customer.checkout_session_id ?? "initial"),
        },
      );
      if (session.livemode || !session.url) throw new Error("Invalid checkout");
      checked(
        await db()
          .from("billing_customers")
          .update({ checkout_session_id: session.id })
          .eq("user_id", user),
      );
      await event("plus_checkout_started");
      return { url: session.url };
    });
  });
}
