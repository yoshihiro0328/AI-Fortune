import { check, TARGET } from "./policy.mjs";
import { setTimeout as delay } from "node:timers/promises";

// One fixed scenario; no caller-supplied API commands, IDs, clock dates or SQL.
// Work performs the browser checkpoints, then the driver independently checks providers.
export const STEPS = [
  "logins",
  "compatibility",
  "first-paid",
  "renewal",
  "failure",
  "end-first",
  "second-paid",
  "portal-cancel",
  "end-second",
  "final",
];
export const MINIMAL_STEPS = [
  "logins",
  "checkout-display",
  "first-paid",
  "portal-display",
  "end-minimal",
  "final-minimal",
];
export function scenario({ wire, evidence, operator, save, minimal = false }) {
  const steps = minimal ? MINIMAL_STEPS : STEPS;
  let index = 0,
    stopped = false,
    seq = 0,
    first,
    second;
  const results = [];
  const persist = (value) =>
    check(save(`scenario-${++seq}.enc`, value).verified);
  const milestone = (stage) => persist({ stage, verified: true });
  const screen = async (checkpoint, context, data = {}) => {
    const result = await operator.request(
      "browser",
      {
        checkpoint,
        app: TARGET.app,
        ...data,
        noSecretCapture: true,
      },
      context.signal,
    );
    check(
      result?.checkpoint === checkpoint && result.observed === true,
      "SCREEN_NOT_CONFIRMED",
    );
    // Deliberately labelled as observer evidence; provider 200 does not prove a screen.
    persist({
      screen: checkpoint,
      source: "operator-observation",
      observed: true,
    });
  };
  const sync = async (context, id, expected, plan, invoiceCount, eventType) => {
    const { m, signal } = context;
    const provider = await context.operations.inspectSubscription(id);
    milestone("subscription-and-invoice-read");
    const current = provider.subscription;
    const period = current.items.data[0];
    const latestInvoice =
      typeof current.latest_invoice === "string"
        ? current.latest_invoice
        : current.latest_invoice?.id;
    if (eventType.startsWith("invoice."))
      check(latestInvoice, "LATEST_INVOICE_REQUIRED");
    // Only reads are polled. Never refresh the billing page to manufacture webhook success.
    for (let n = 0; n < 12; n++) {
      const rows = await wire({
        provider: "supabase",
        role: "service",
        operation: "verify_synced_subscription",
        path: `/rest/v1/subscriptions?select=*&user_id=eq.${m.c.id}&id=eq.${id}`,
        signal,
      });
      if (
        rows.length === 1 &&
        rows[0].status === expected &&
        new Date(rows[0].period_start).getTime() ===
          period.current_period_start * 1000 &&
        new Date(rows[0].period_end).getTime() ===
          period.current_period_end * 1000 &&
        rows[0].cancel_at_period_end === !!current.cancel_at_period_end &&
        evidence.hasDelivery(
          eventType,
          id,
          eventType.startsWith("invoice.") ? latestInvoice : undefined,
        )
      ) {
        const usage = await wire({
          provider: "supabase",
          role: "service",
          method: "POST",
          path: "/rest/v1/rpc/consultation_entitlement",
          body: { p_user: m.c.id },
          operation: "verify_current_entitlement",
          signal,
        });
        check(
          usage.plan === plan && usage.limit === (plan === "plus" ? 30 : 3),
          "CURRENT_ENTITLEMENT_MISMATCH",
        );
        await evidence.rls(
          context.operations.state().subscriptions.length,
          invoiceCount,
          signal,
        );
        milestone("webhook-database-entitlement-rls-confirmed");
        persist({
          sync: { id, expected, plan, invoiceCount, eventType },
          usage,
        });
        return;
      }
      check(n < 11, "WEBHOOK_SYNC_NOT_CONFIRMED");
      await delay(5000, undefined, { signal });
    }
  };
  const observe = async (context, id, count, status, invoiceStatus) => {
    const value = await context.operations.inspectSubscription(id);
    check(
      value.subscription.status === status &&
        value.invoices.length === count &&
        value.invoices.filter((i) => i.status === invoiceStatus).length >= 1,
      "BILLING_STATE_MISMATCH",
    );
    return value;
  };
  const boundary = (s) => {
    const value = s.items.data[0].current_period_end;
    check(Number.isSafeInteger(value), "PERIOD_END_REQUIRED");
    return value;
  };
  const execute = async (command, context) => {
    check(!stopped && !context.signal.aborted, "SCENARIO_STOPPED");
    if (command === "verify-complete") return index === steps.length;
    check(command === "next" && index < steps.length, "SCENARIO_COMMAND");
    const step = steps[index],
      ops = context.operations;
    try {
      persist({ step, state: "reserved" });
      switch (step) {
        case "logins":
          await screen(step, context);
          await evidence.logins(context.signal);
          await evidence.rls(0, 0, context.signal);
          break;
        case "checkout-display": {
          await screen("checkout-first-display", context);
          check(
            ops.state().checkouts.length === 1 &&
              ops.state().subscriptions.length === 0,
          );
          const c = await ops.bindCheckout(ops.state().checkouts[0]);
          check(c.status === "open" && !c.paid);
          break;
        }
        case "portal-display":
          await screen("minimal-plus-and-portal-return", context);
          await evidence.rls(1, 1, context.signal);
          break;
        case "end-minimal":
          await ops.endSubscription(first);
          await observe(context, first, 1, "canceled", "paid");
          await sync(
            context,
            first,
            "canceled",
            "free",
            1,
            "customer.subscription.deleted",
          );
          break;
        case "final-minimal":
          await screen("account-and-denials", context);
          await evidence.rls(1, 1, context.signal);
          check(context.runtime.alive(), "PROCESS_FAILED");
          break;
        case "compatibility": {
          await screen("checkout-first-display", context);
          check(
            ops.state().checkouts.length === 1 &&
              ops.state().subscriptions.length === 0,
          );
          const c = await ops.bindCheckout(ops.state().checkouts[0]);
          check(c.status === "open" && !c.paid, "PAYMENT_BEFORE_COMPATIBILITY");
          const portal = await ops.compatibilityPortal();
          await screen("portal-first-return", context, portal);
          break;
        }
        case "first-paid": {
          // This prompt can issue one purchase only. A return-page failure is
          // separate from payment outcome; read the same Checkout, never repurchase.
          const observation = await operator.request(
            "browser",
            {
              checkpoint: "pay-first-once",
              app: TARGET.app,
              noSecretCapture: true,
              allowPaidReconciliation: minimal,
            },
            context.signal,
          );
          check(
            observation?.checkpoint === "pay-first-once" &&
              (observation.observed === true ||
                (minimal && observation.purchaseAttempted === true)),
            "PAYMENT_ATTEMPT_NOT_CONFIRMED",
          );
          persist({
            stage: "payment-browser-return",
            observed: observation.observed === true,
            purchaseAttempted: true,
          });
          check((await ops.bindCheckout(ops.state().checkouts[0])).paid);
          milestone("checkout-paid-confirmed");
          check(ops.state().subscriptions.length === 1);
          first = ops.state().subscriptions[0];
          await observe(context, first, 1, "active", "paid");
          milestone("active-contract-paid-invoice-confirmed");
          await sync(
            context,
            first,
            "active",
            "plus",
            1,
            "checkout.session.completed",
          );
          if (minimal)
            await sync(context, first, "active", "plus", 1, "invoice.paid");
          break;
        }
        case "renewal": {
          const initial = await observe(context, first, 1, "active", "paid");
          const end = boundary(initial.subscription);
          await ops.advanceClock(end);
          await observe(context, first, 2, "active", "draft");
          await ops.advanceClock(end + 3600);
          const after = await observe(context, first, 2, "active", "paid");
          check(after.invoices.every((i) => i.status === "paid"));
          await sync(context, first, "active", "free", 2, "invoice.paid");
          await evidence.replay(context.runtime, first, context.signal);
          await sync(context, first, "active", "free", 2, "invoice.paid");
          break;
        }
        case "failure": {
          await ops.paymentMethod(first, true);
          const before = await observe(context, first, 2, "active", "paid");
          const end = boundary(before.subscription);
          await ops.advanceClock(end);
          await observe(context, first, 3, "active", "draft");
          await ops.advanceClock(end + 3600);
          const after = await observe(context, first, 3, "past_due", "open");
          const failed = after.invoices.filter((i) => i.status === "open");
          check(
            failed.length === 1 &&
              failed[0].attempt_count === 1 &&
              failed[0].next_payment_attempt === null,
            "AUTOMATIC_RETRY_NOT_DISABLED",
          );
          await sync(
            context,
            first,
            "past_due",
            "free",
            3,
            "invoice.payment_failed",
          );
          break;
        }
        case "end-first":
          await ops.paymentMethod(first, false);
          await ops.endSubscription(first);
          await sync(
            context,
            first,
            "canceled",
            "free",
            3,
            "customer.subscription.deleted",
          );
          break;
        case "second-paid":
          await screen("pay-second-once", context);
          check(ops.state().checkouts.length === 2);
          check((await ops.bindCheckout(ops.state().checkouts[1])).paid);
          check(ops.state().subscriptions.length === 2);
          second = ops.state().subscriptions.find((id) => id !== first);
          await observe(context, second, 1, "active", "paid");
          // Stripe's Clock is now two months ahead; never call this current Plus.
          await sync(
            context,
            second,
            "active",
            "free",
            4,
            "checkout.session.completed",
          );
          break;
        case "portal-cancel": {
          await screen("portal-second-cancel-once-return", context);
          const value = await observe(context, second, 1, "active", "paid");
          check(
            value.subscription.cancel_at_period_end === true,
            "PORTAL_CANCEL_NOT_CONFIRMED",
          );
          await sync(
            context,
            second,
            "active",
            "free",
            4,
            "customer.subscription.updated",
          );
          break;
        }
        case "end-second": {
          const value = await observe(context, second, 1, "active", "paid");
          await ops.advanceClock(boundary(value.subscription));
          await observe(context, second, 1, "canceled", "paid");
          await sync(
            context,
            second,
            "canceled",
            "free",
            4,
            "customer.subscription.deleted",
          );
          break;
        }
        case "final":
          await screen("account-and-denials", context);
          await evidence.rls(2, 4, context.signal);
          check(context.runtime.alive(), "PROCESS_FAILED");
          break;
      }
      index++;
      results.push(step);
      persist({ step, state: "verified", completed: [...results] });
      return true;
    } catch {
      stopped = true;
      ops.stop();
      persist({ step, state: "failed_or_unknown" });
      throw Error("SCENARIO_STOPPED");
    }
  };
  execute.commands = ["next"];
  return execute;
}
