import { localSubscriptionIntegration } from "@/lib/stripe/local-subscription";
import { assertCheckoutPrice } from "@/lib/stripe/checkout";
import { stripeId } from "@/lib/stripe/subscriptions";
import { stripeEnvironment } from "@/lib/stripe/environment";
import { assertCheckoutEnabled, assertStripeMode } from "@/lib/stripe/mode";
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
    await stripeEnvironment();
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
            "id,amount,status,period_end,ended_at,paid_through,cancel_at_period_end,cancel_at",
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
    if (
      localSubscriptionIntegration() &&
      user !== process.env.SUBSCRIPTION_BUYER_ID
    )
      throw new HttpError(403, "この検証では契約操作を利用できません。");
    await rate("billing:" + user, 20, 3600);
    return lock("billing:" + user, async () => {
      const environment = await stripeEnvironment();
      const s = stripe();
      let customer = checked(
        await db()
          .from("billing_customers")
          .select("*")
          .eq("user_id", user)
          .maybeSingle(),
      );
      if (customer) {
        if (customer.is_test !== environment.isTest)
          throw new Error("Customer environment mismatch");
        const remote = await s.customers.retrieve(customer.stripe_customer_id);
        if (remote.deleted) throw new Error("Customer deleted");
        assertStripeMode(remote, environment.mode);
      }
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
            assertStripeMode(sub, environment.mode);
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
        const configuration = await s.billingPortal.configurations.retrieve(
          settings.portal_configuration_id,
        );
        assertStripeMode(configuration, environment.mode);
        if (!configuration.active) throw new Error("Portal inactive");
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
      assertCheckoutEnabled();
      const { price, row } = await offer("plus");
      const limits = await serviceSettings();
      if (!customer) {
        const c = await s.customers.create(
          { metadata: { app: "yorisoi", user_id: user } },
          {
            idempotencyKey: "yorisoi-customer:" + environment.mode + ":" + user,
          },
        );
        assertStripeMode(c, environment.mode);
        customer = checked(
          await db()
            .from("billing_customers")
            .insert({
              user_id: user,
              stripe_customer_id: c.id,
              is_test: environment.isTest,
            })
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
        assertStripeMode(previous, environment.mode);
        if (
          previous.status === "open" &&
          previous.url &&
          previous.amount_total === price.unit_amount &&
          previous.currency === "jpy" &&
          previous.metadata?.user_id === user &&
          stripeId(previous.customer) === customer.stripe_customer_id
        ) {
          await assertCheckoutPrice(
            previous,
            price,
            environment.mode,
            "subscription",
          );
          return { url: previous.url };
        }
        if (previous.status === "open")
          await s.checkout.sessions.expire(previous.id);
        if (previous.status === "complete") {
          const id = stripeId(previous.subscription);
          const completed = id ? await s.subscriptions.retrieve(id) : null;
          if (
            !completed ||
            !["canceled", "incomplete_expired"].includes(completed.status)
          )
            throw new HttpError(
              409,
              "契約の反映を確認しています。少し待ってからマイページをご確認ください。",
            );
          assertStripeMode(completed, environment.mode);
        }
      }
      const session = await s.checkout.sessions.create(
        {
          mode: "subscription",
          automatic_tax: { enabled: false },
          custom_text: {
            submit: {
              message: `AIとのやり取りは契約期間ごとに${limits.plus_limit}往復まで。${exchangeExplanation}詳細診断は別料金です。${environment.isTest ? "現在はテスト決済のみで実請求は発生しません。" : ""}`,
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
            "plus:" +
            environment.mode +
            ":" +
            user +
            ":" +
            (customer.checkout_session_id ?? "initial"),
        },
      );
      assertStripeMode(session, environment.mode);
      if (
        session.amount_total !== price.unit_amount ||
        session.currency !== "jpy" ||
        !session.url
      )
        throw new Error("Invalid checkout");
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
