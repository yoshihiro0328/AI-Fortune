import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe/client";
import { syncSubscription } from "@/lib/stripe/subscriptions";
import { checked, db } from "@/lib/supabase/admin";
const live = process.env.RUN_SUBSCRIPTION_LIVE === "1";
it.skipIf(!live)(
  "Sandbox subscription payment, replay, renewal, failure, cancel and resubscribe",
  async () => {
    const s = stripe();
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const price = checked(
      await db()
        .from("price_versions")
        .select("stripe_price_id")
        .eq("id", "plus-2026-10-980")
        .single(),
    )!;
    const { data, error } = await admin.auth.admin.createUser({
      email: "qa-subscription-" + randomUUID() + "@example.invalid",
      password: randomUUID() + "Aa!",
      email_confirm: true,
      user_metadata: { test_fixture: true },
    });
    if (error) throw error;
    const user = data.user.id;
    const clock = await s.testHelpers.testClocks.create({
      frozen_time: Math.floor(Date.now() / 1000),
      name: "よりそい 継続契約 QA",
    });
    const customer = await s.customers.create({
      test_clock: clock.id,
      payment_method: "pm_card_visa",
      invoice_settings: { default_payment_method: "pm_card_visa" },
      metadata: { app: "yorisoi", test_fixture: "true" },
    });
    expect(customer.livemode).toBe(false);
    checked(
      await db()
        .from("billing_customers")
        .insert({ user_id: user, stripe_customer_id: customer.id }),
    );
    const evidence: Record<string, unknown> = {
      user,
      customer: customer.id,
      clock: clock.id,
      checks: [],
    };
    const checks = evidence.checks as string[];
    const created = await s.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.stripe_price_id }],
      payment_behavior: "error_if_incomplete",
      metadata: { app: "yorisoi", test_fixture: "true" },
    });
    expect(created.status).toBe("active");
    await syncSubscription(created.id);
    checks.push("real Sandbox initial payment and snapshot");
    let usage = checked(
      await db().rpc("consultation_entitlement", { p_user: user }),
    );
    expect(usage.plan).toBe("plus");
    expect(usage.limit).toBe(30);
    checks.push("paid entitlement 30");
    const portalSetting = checked(
      await db()
        .from("service_settings")
        .select("portal_configuration_id")
        .single(),
    )!;
    const portal = await s.billingPortal.sessions.create({
      customer: customer.id,
      configuration: portalSetting.portal_configuration_id,
      return_url: "https://partner-mind-vdiordna-2059.vercel.app/account",
    });
    expect(portal.url).toMatch(/^https:\/\/billing.stripe.com\//);
    checks.push("Customer Portal created");
    const originalEvent = (
      await s.events.list({ type: "customer.subscription.created", limit: 10 })
    ).data.find(
      (e) => "id" in e.data.object && e.data.object.id === created.id,
    )!;
    expect(originalEvent).toBeTruthy();
    async function replay(e: typeof originalEvent) {
      const raw = JSON.stringify(e),
        signature = s.webhooks.generateTestHeaderString({
          payload: raw,
          secret: process.env.STRIPE_WEBHOOK_SECRET!,
        });
      const r = await fetch(
        (process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100") +
          "/api/webhooks/stripe",
        {
          method: "POST",
          headers: {
            "stripe-signature": signature,
            "content-type": "application/json",
          },
          body: raw,
        },
      );
      expect(r.status).toBe(200);
    }
    await replay(originalEvent);
    await replay(originalEvent);
    checks.push("real signed event replay twice");
    const cancel = await s.subscriptions.update(created.id, {
      cancel_at_period_end: true,
    });
    await syncSubscription(created.id);
    expect(cancel.cancel_at_period_end).toBe(true);
    usage = checked(
      await db().rpc("consultation_entitlement", { p_user: user }),
    );
    expect(usage.plan).toBe("plus");
    checks.push("period-end cancel retains entitlement");
    await replay(originalEvent);
    let saved = checked(
      await db()
        .from("subscriptions")
        .select("*")
        .eq("id", created.id)
        .single(),
    )!;
    expect(saved.cancel_at_period_end).toBe(true);
    checks.push("out-of-order old event keeps latest cancellation");
    await s.subscriptions.update(created.id, { cancel_at_period_end: false });
    await syncSubscription(created.id);
    async function advance(target: number) {
      await s.testHelpers.testClocks.advance(clock.id, { frozen_time: target });
      for (let i = 0; i < 20; i++) {
        const c = await s.testHelpers.testClocks.retrieve(clock.id);
        if (c.status === "ready") return;
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("Clock did not become ready");
    }
    let current = await s.subscriptions.retrieve(created.id);
    await advance(current.items.data[0].current_period_end + 3600);
    current = await s.subscriptions.retrieve(created.id);
    await syncSubscription(current.id);
    saved = checked(
      await db()
        .from("subscriptions")
        .select("*")
        .eq("id", current.id)
        .single(),
    )!;
    const invoices = checked(
      await db()
        .from("subscription_invoices")
        .select("id,status,period_end")
        .eq("subscription_id", current.id),
    )!;
    expect(
      invoices.filter((i) => i.status === "paid").length,
    ).toBeGreaterThanOrEqual(2);
    checks.push("test-clock renewal paid");
    const failing = await s.paymentMethods.attach(
      "pm_card_chargeCustomerFail",
      { customer: customer.id },
    );
    await s.customers.update(customer.id, {
      invoice_settings: { default_payment_method: failing.id },
    });
    await s.subscriptions.update(current.id, {
      default_payment_method: failing.id,
    });
    await advance(current.items.data[0].current_period_end + 7200);
    current = await s.subscriptions.retrieve(current.id);
    await syncSubscription(current.id);
    expect(["past_due", "unpaid", "canceled"]).toContain(current.status);
    checks.push("test-clock renewal payment failed");
    await s.subscriptions.cancel(current.id);
    await syncSubscription(current.id);
    usage = checked(
      await db().rpc("consultation_entitlement", { p_user: user }),
    );
    expect(usage.plan).toBe("free");
    checks.push("immediate contract end gives free");
    const good = await s.paymentMethods.attach("pm_card_visa", {
      customer: customer.id,
    });
    await s.customers.update(customer.id, {
      invoice_settings: { default_payment_method: good.id },
    });
    const again = await s.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.stripe_price_id }],
      default_payment_method: good.id,
      payment_behavior: "error_if_incomplete",
      metadata: { app: "yorisoi", test_fixture: "true" },
    });
    expect(again.status).toBe("active");
    await syncSubscription(again.id);
    checks.push("resubscribe after end");
    await s.subscriptions.update(again.id, { cancel_at_period_end: true });
    await syncSubscription(again.id);
    await advance(again.items.data[0].current_period_end + 3600);
    const ended = await s.subscriptions.retrieve(again.id);
    expect(ended.status).toBe("canceled");
    await syncSubscription(again.id);
    checks.push("scheduled cancellation reaches canceled");
    evidence.firstSubscription = created.id;
    evidence.secondSubscription = again.id;
    evidence.finalStatus = ended.status;
    await writeFile(
      "../../work/subscription-lifecycle.json",
      JSON.stringify(evidence, null, 2),
    );
  },
  600000,
);
