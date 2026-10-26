import { remainingPlan, operationLedger } from "./remaining-plan.mjs";
import { TARGET, check } from "./policy.mjs";
import {
  retainedE,
  resumedMonthlyPlan,
  monthlyCarry,
  monthlyContinuation,
} from "./monthly-resume.mjs";

export const MONTHLY_PRICE = "price_1UQlpjI73kTcvXz814TUAfOd";
export const MONTHLY_VERSION = "plus-integration-202610-980-v1";
export const MONTHLY_PRODUCT = "prod_VRfAjqXSjem3nl";
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;
const identifier = (s, prefix) =>
  typeof s === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(s);
const protectedUsers = new Set([
  "74a7ac25-66f2-450e-a6a4-c72e498fd638",
  "ff82e4fe-6de5-4dde-887f-9ae7e8caf89b",
  retainedE,
]);

// UTC calendar arithmetic, including the February/month-end clamp. Not 30 days.
export function initialClockTime(now) {
  check(Number.isSafeInteger(now) && now > 0);
  const d = new Date(now * 1000);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  d.setUTCDate(Math.min(day, last.getUTCDate()));
  return Math.floor(d.getTime() / 1000) - 7200;
}

// Only the explicitly enumerated E/F operations exist here. No caller-supplied
// endpoint/body, billing settings, catalog, old user, Checkout or Portal writes.
// checkpoint must be durable BEFORE dispatch. Never retry a failed checkpoint
// or an unknown write. Cleanup has a separate bounded gate, not a reopened trial.
export function monthlyOperations({
  run,
  users,
  wire,
  checkpoint,
  deadline,
  signal,
  continuation = false,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  check(uuid.test(run) && typeof checkpoint === "function");
  check(
    Number.isFinite(deadline) &&
      deadline > now() &&
      deadline <= now() + 1200000,
  );
  check(Object.keys(users).sort().join() === "e,f");
  check(new Set(Object.values(users).map((u) => u.id)).size === 2);
  for (const u of Object.values(users))
    check(
      uuid.test(u.id) &&
        !protectedUsers.has(u.id) &&
        u.email === `plus-${run}-${u.id}@example.com` &&
        typeof u.password === "string" &&
        u.password.length >= 16,
    );
  check(typeof continuation === "boolean");
  const plan = continuation ? resumedMonthlyPlan : remainingPlan;
  const ledger = operationLedger(plan, continuation ? monthlyCarry : {});
  const state = {
    run,
    continuation: continuation ? monthlyContinuation : null,
    fixtures: {
      e: { expectedUser: users.e.id },
      f: { expectedUser: users.f.id },
    },
    journal: [],
    stopped: false,
    successfulInvoices: continuation ? [monthlyContinuation.paidInvoice] : [],
    failedAttempts: 0,
    notificationPhaseEnded: false,
  };
  let seq = 0,
    cleanupDeadline;
  const save = async (operation, outcome) => {
    state.journal.push({ seq: ++seq, operation, outcome, at: now() });
    await checkpoint({
      ...structuredClone(state),
      allowance: ledger.summary(),
    });
  };
  const remaining = (cleanup) => {
    check(cleanup || !signal?.aborted, "MONTHLY_INTERRUPTED");
    const end = cleanup ? cleanupDeadline : deadline;
    check(Number.isFinite(end) && end > now(), "MONTHLY_DEADLINE");
    return end - now();
  };
  const request = (provider, method, path, body, operation, cleanup = false) =>
    wire({
      provider,
      method,
      path,
      body,
      operation,
      role: provider === "stripe" ? "lifecycle" : "service",
      signal: AbortSignal.any([
        AbortSignal.timeout(Math.min(15000, remaining(cleanup))),
        ...(!cleanup && signal ? [signal] : []),
      ]),
      ...(method !== "GET" ? { idempotencyKey: `${run}-${operation}` } : {}),
    });
  const get = (provider, path, cleanup = false) =>
    request(provider, "GET", path, undefined, "monthly_read", cleanup);
  const change = async (kind, label, fn, cleanup = false) => {
    remaining(cleanup);
    check(cleanup || !state.stopped, "MONTHLY_STOPPED");
    if (cleanup) {
      check(["immediateCancellations", "invoiceVoids"].includes(kind));
      check(
        !state.journal.some(
          (j) => j.operation === label && j.outcome === "reserved",
        ),
      );
      check(
        state.journal.filter(
          (j) => j.operation.startsWith(kind + "-") && j.outcome === "reserved",
        ).length < remainingPlan.limits[kind],
      );
    } else ledger.reserve(kind, label);
    try {
      await save(label, "reserved");
      remaining(cleanup);
      const out = await fn();
      await save(label, "verified");
      return out;
    } catch {
      state.stopped = true;
      ledger.unknown();
      await save(label, "unknown");
      throw Error("MONTHLY_WRITE_UNKNOWN_NO_RESEND");
    }
  };
  const row = (rows, id) => {
    check(Array.isArray(rows) && rows.length === 1 && rows[0].user_id === id);
    return rows[0];
  };
  const fixture = (label) => {
    check(["e", "f"].includes(label));
    return state.fixtures[label];
  };
  const subscriptionCheck = (
    s,
    label,
    expectedId = fixture(label).subscription,
  ) => {
    const f = fixture(label);
    check(
      s.id === expectedId &&
        s.customer === f.customer &&
        s.livemode === false &&
        s.test_clock === f.clock &&
        s.metadata?.run === run &&
        s.metadata?.user_id === users[label].id &&
        s.items?.data?.length === 1 &&
        s.items.data[0].price.id === MONTHLY_PRICE &&
        s.items.data[0].quantity === 1 &&
        s.items.data[0].price.unit_amount === 980 &&
        s.items.data[0].price.currency === "jpy",
      "MONTHLY_SUBSCRIPTION_MISMATCH",
    );
    return s;
  };
  const api = {
    state: () => structuredClone(state),
    cleanupRemaining: () => Math.max(0, (cleanupDeadline ?? 0) - now()),
    async identify() {
      const a = await get("stripe", "/v1/account");
      check(a.id === TARGET.account, "TARGET_MISMATCH");
      const env = await get(
        "supabase",
        "/rest/v1/payment_environment?select=mode,stripe_account_id",
      );
      check(
        env.length === 1 &&
          env[0].mode === "sandbox" &&
          env[0].stripe_account_id === TARGET.account,
      );
      const p = await get("stripe", "/v1/prices/" + MONTHLY_PRICE);
      check(
        p.id === MONTHLY_PRICE &&
          p.livemode === false &&
          p.active === true &&
          p.product === MONTHLY_PRODUCT &&
          p.unit_amount === 980 &&
          p.currency === "jpy" &&
          p.recurring?.interval === "month" &&
          p.recurring.interval_count === 1,
      );
      const prices = await get(
        "supabase",
        "/rest/v1/price_versions?select=id,active,is_test,stripe_price_id&stripe_price_id=eq." +
          MONTHLY_PRICE,
      );
      check(
        prices.length === 1 &&
          prices[0].id === MONTHLY_VERSION &&
          prices[0].active === false &&
          prices[0].is_test === true,
      );
      await save("identify", "verified");
    },
    async prepare(label) {
      const f = fixture(label),
        u = users[label];
      check(
        state.journal.some(
          (j) => j.operation === "identify" && j.outcome === "verified",
        ),
      );
      await change("users", "user-" + label, async () => {
        const out = await request(
          "supabase",
          "POST",
          "/auth/v1/admin/users",
          {
            id: u.id,
            email: u.email,
            password: u.password,
            email_confirm: true,
            app_metadata: { integration_run: run },
          },
          "monthly_user_" + label,
        );
        const user = out.user ?? out;
        check(user.id === u.id && user.email_confirmed_at);
        f.user = user.id;
      });
      // The profile may be initialized by an Auth trigger. Inspect first and
      // insert only if absent; never use an upsert against pre-existing users.
      const profiles = await get(
        "supabase",
        "/rest/v1/profiles?select=user_id&user_id=eq." + u.id,
      );
      check(Array.isArray(profiles) && profiles.length <= 1);
      if (profiles.length === 0) {
        // One profile/binding per newly created user. Not an extra Auth user.
        check(!f.profile);
        await save("profile-" + label, "reserved");
        try {
          row(
            await request(
              "supabase",
              "POST",
              "/rest/v1/profiles",
              { user_id: u.id },
              "monthly_profile_" + label,
            ),
            u.id,
          );
        } catch {
          state.stopped = true;
          ledger.unknown();
          throw Error("MONTHLY_WRITE_UNKNOWN_NO_RESEND");
        }
      } else row(profiles, u.id);
      f.profile = true;
      await save("profile-" + label, "verified");
      const frozen = initialClockTime(Math.floor(now() / 1000));
      await change("clocks", "clock-" + label, async () => {
        const c = await request(
          "stripe",
          "POST",
          "/v1/test_helpers/test_clocks",
          {
            frozen_time: frozen,
            name: `monthly-${run}-${label}`,
          },
          "monthly_clock_" + label,
        );
        check(
          identifier(c.id, "clock") &&
            c.livemode === false &&
            c.status === "ready" &&
            c.frozen_time === frozen,
        );
        f.clock = c.id;
        f.frozen = frozen;
        f.advances = 0;
      });
      await change("customers", "customer-" + label, async () => {
        const c = await request(
          "stripe",
          "POST",
          "/v1/customers",
          {
            test_clock: f.clock,
            metadata: { run, user_id: u.id },
          },
          "monthly_customer_" + label,
        );
        check(
          identifier(c.id, "cus") &&
            c.livemode === false &&
            c.test_clock === f.clock &&
            c.metadata?.run === run &&
            c.metadata?.user_id === u.id,
        );
        f.customer = c.id;
      });
      await save("binding-" + label, "reserved");
      try {
        const b = row(
          await request(
            "supabase",
            "POST",
            "/rest/v1/billing_customers",
            {
              user_id: u.id,
              stripe_customer_id: f.customer,
              is_test: true,
            },
            "monthly_binding_" + label,
          ),
          u.id,
        );
        check(b.stripe_customer_id === f.customer && b.is_test === true);
        f.binding = true;
        await save("binding-" + label, "verified");
      } catch {
        state.stopped = true;
        ledger.unknown();
        throw Error("MONTHLY_WRITE_UNKNOWN_NO_RESEND");
      }
    },
    async attach(label, failing = false) {
      const f = fixture(label);
      check(f.binding && (!failing || (label === "f" && f.subscription)));
      return change(
        "paymentMethodAttachments",
        `method-${label}-${failing ? "failure" : "initial"}`,
        async () => {
          const p = await request(
            "stripe",
            "POST",
            `/v1/payment_methods/${failing ? "pm_card_chargeCustomerFail" : "pm_card_visa"}/attach`,
            { customer: f.customer },
            `monthly_method_${label}_${failing ? "failure" : "initial"}`,
          );
          check(
            identifier(p.id, "pm") &&
              p.customer === f.customer &&
              p.livemode === false,
          );
          if (failing) f.failureMethod = p.id;
          else f.initialMethod = p.id;
          return p.id;
        },
      );
    },
    async createSubscription(label) {
      const f = fixture(label);
      check(f.initialMethod && f.binding);
      ledger.reserve("successfulPayments", "initial-payment-" + label);
      await change("subscriptions", "subscription-" + label, async () => {
        const s = await request(
          "stripe",
          "POST",
          "/v1/subscriptions",
          {
            customer: f.customer,
            items: [{ price: MONTHLY_PRICE, quantity: 1 }],
            default_payment_method: f.initialMethod,
            collection_method: "charge_automatically",
            billing_mode: { type: "flexible" },
            payment_behavior: "error_if_incomplete",
            automatic_tax: { enabled: false },
            metadata: { run, user_id: users[label].id },
          },
          "monthly_subscription_" + label,
        );
        check(identifier(s.id, "sub"));
        subscriptionCheck(s, label, s.id);
        f.subscription = s.id;
        f.initialEnd = s.items.data[0].current_period_end;
        check(Number.isSafeInteger(f.initialEnd));
      });
    },
    async subscription(label, cleanup = false) {
      const f = fixture(label);
      check(f.subscription);
      const s = subscriptionCheck(
        await get("stripe", "/v1/subscriptions/" + f.subscription, cleanup),
        label,
      );
      f.periodEnd = s.items.data[0].current_period_end;
      return s;
    },
    async invoices(label, cleanup = false) {
      const f = fixture(label);
      check(f.subscription);
      const list = await get(
        "stripe",
        `/v1/invoices?subscription=${f.subscription}&limit=3`,
        cleanup,
      );
      check(
        list.has_more === false && list.data.length <= 2,
        "MONTHLY_INVOICE_CAP",
      );
      for (const i of list.data) {
        check(
          identifier(i.id, "in") &&
            i.customer === f.customer &&
            i.livemode === false &&
            i.parent?.subscription_details?.subscription === f.subscription &&
            i.currency === "jpy" &&
            i.total === 980 &&
            i.lines?.has_more === false &&
            i.lines.data.length === 1 &&
            i.lines.data[0].pricing?.price_details?.price === MONTHLY_PRICE,
          "MONTHLY_INVOICE_MISMATCH",
        );
        if (i.status === "paid") {
          check(i.amount_paid === 980 && i.amount_remaining === 0);
          if (!state.successfulInvoices.includes(i.id))
            state.successfulInvoices.push(i.id);
          check(
            state.successfulInvoices.length <= plan.limits.successfulPayments,
            "MONTHLY_PAYMENT_CAP",
          );
        }
        if (label === "f" && i.status !== "paid") {
          check(Number.isSafeInteger(i.attempt_count) && i.attempt_count <= 9);
          state.failedAttempts = Math.max(
            state.failedAttempts,
            i.attempt_count,
          );
          if (i.status === "open") f.openInvoice = i.id;
        }
      }
      f.paidInvoices = list.data.filter((i) => i.status === "paid").length;
      await save("observe-invoices-" + label, "verified");
      return list.data;
    },
    async switchFailureMethod() {
      const f = fixture("f");
      check(f.failureMethod && f.subscription);
      await change("paymentMethodSwitches", "switch-f", async () => {
        const s = await request(
          "stripe",
          "POST",
          "/v1/subscriptions/" + f.subscription,
          {
            default_payment_method: f.failureMethod,
            proration_behavior: "none",
          },
          "monthly_switch_f",
        );
        subscriptionCheck(s, "f");
        check(s.default_payment_method === f.failureMethod);
        f.failureSwitched = true;
      });
    },
    async scheduleEnd() {
      const f = fixture("e");
      check(
        f.subscription && f.paidInvoices === 2 && f.periodEnd > f.initialEnd,
      );
      await change("scheduledCancellations", "schedule-e", async () => {
        const s = await request(
          "stripe",
          "POST",
          "/v1/subscriptions/" + f.subscription,
          { cancel_at_period_end: true, proration_behavior: "none" },
          "monthly_schedule_e",
        );
        subscriptionCheck(s, "e");
        check(s.cancel_at_period_end === true);
        f.scheduledEnd = s.items.data[0].current_period_end;
      });
    },
    async advance(label, target) {
      const f = fixture(label);
      check(
        Number.isSafeInteger(target) &&
          target > f.frozen &&
          target - f.frozen <= 32 * 86400 &&
          f.advances < (label === "e" ? (continuation ? 3 : 4) : 12) &&
          !f.pending,
        "MONTHLY_CLOCK_DENIED",
      );
      check(f.subscription && f.initialEnd, "SUBSCRIPTION_REQUIRED");
      if (label === "e") {
        check(
          target <= (f.scheduledEnd ?? f.initialEnd + 3600),
          "SECOND_RENEWAL_DENIED",
        );
        if (!f.renewalReserved && target >= f.initialEnd) {
          ledger.reserve("successfulPayments", "renewal-payment-e");
          f.renewalReserved = true;
        }
      } else {
        check(
          f.failureSwitched &&
            target <
              (f.periodEnd > f.initialEnd
                ? f.periodEnd
                : f.initialEnd + 20 * 86400),
          "FAILURE_PERIOD_BOUND_REQUIRED",
        );
        check(state.failedAttempts < 9, "FAILURE_ATTEMPT_CAP");
      }
      const c = await get("stripe", "/v1/test_helpers/test_clocks/" + f.clock);
      check(
        c.id === f.clock &&
          c.livemode === false &&
          c.status === "ready" &&
          c.frozen_time === f.frozen,
      );
      await change(
        "clockAdvances",
        `advance-${label}-${f.advances + 1}`,
        async () => {
          f.pending = target;
          f.advances++;
          const c = await request(
            "stripe",
            "POST",
            `/v1/test_helpers/test_clocks/${f.clock}/advance`,
            { frozen_time: target },
            `monthly_advance_${label}_${f.advances}`,
          );
          check(
            c.id === f.clock &&
              c.livemode === false &&
              ["advancing", "ready"].includes(c.status) &&
              (c.status === "ready"
                ? c.frozen_time === target
                : [f.frozen, target].includes(c.frozen_time)),
            "CLOCK_ADVANCE_RESPONSE_MISMATCH",
          );
        },
      );
      const until = Math.min(deadline, now() + 60000);
      for (let n = 0; n < 12 && now() < until; n++) {
        const c = await get(
          "stripe",
          "/v1/test_helpers/test_clocks/" + f.clock,
        );
        check(
          c.id === f.clock &&
            c.livemode === false &&
            ["advancing", "ready"].includes(c.status) &&
            (c.status === "ready"
              ? c.frozen_time === target
              : [f.frozen, target].includes(c.frozen_time)),
          "CLOCK_POLL_RESPONSE_MISMATCH",
        );
        if (c.status === "ready") {
          f.frozen = target;
          delete f.pending;
          await save("clock-ready-" + label, "verified");
          return;
        }
        check(c.status === "advancing");
        await sleep(Math.min(5000, Math.max(0, until - now())));
      }
      state.stopped = true;
      ledger.unknown();
      throw Error("MONTHLY_CLOCK_NOT_READY");
    },
    async beginCleanup() {
      check(cleanupDeadline === undefined, "CLEANUP_ALREADY_STARTED");
      state.stopped = true;
      state.notificationPhaseEnded = true;
      cleanupDeadline = now() + remainingPlan.cleanupSeconds * 1000;
      await save("notification-phase-ended", "verified");
    },
    async closeSubscription(label) {
      const f = fixture(label);
      if (!f.subscription) return;
      // Avoid canceling during asynchronous advancement. Wait by read only,
      // within the existing cleanup window, before the sole cancel.
      const readyUntil = Math.min(now() + 30000, cleanupDeadline - 15000);
      let ready = false;
      for (let n = 0; n < 7 && now() < readyUntil; n++) {
        const c = await get(
          "stripe",
          "/v1/test_helpers/test_clocks/" + f.clock,
          true,
        );
        check(c.id === f.clock && c.livemode === false, "CLEANUP_CLOCK_SCOPE");
        if (c.status === "ready") {
          check(
            [f.frozen, f.pending].includes(c.frozen_time),
            "CLEANUP_CLOCK_TIME",
          );
          ready = true;
          break;
        }
        check(c.status === "advancing", "CLEANUP_CLOCK_STATUS");
        await sleep(Math.min(5000, Math.max(0, readyUntil - now())));
      }
      check(ready, "CLEANUP_CLOCK_NOT_READY_NO_CANCEL_SENT");
      const s = await api.subscription(label, true);
      if (s.status === "canceled") return;
      await change(
        "immediateCancellations",
        "immediateCancellations-" + label,
        async () => {
          const out = await request(
            "stripe",
            "DELETE",
            "/v1/subscriptions/" + f.subscription,
            { prorate: false, invoice_now: false },
            "monthly_cleanup_" + label,
            true,
          );
          subscriptionCheck(out, label);
          check(out.status === "canceled");
        },
        true,
      );
    },
    async reconcileUnknownSubscription(label) {
      const f = fixture(label);
      check(
        state.notificationPhaseEnded && !f.reconciled,
        "RECONCILIATION_DENIED",
      );
      if (
        f.subscription ||
        !f.customer ||
        !state.journal.some(
          (j) =>
            j.operation === "subscription-" + label && j.outcome === "unknown",
        )
      )
        return;
      f.reconciled = true;
      await save("reconcile-subscription-" + label, "reserved");
      const list = await get(
        "stripe",
        `/v1/subscriptions?customer=${f.customer}&status=all&limit=3`,
        true,
      );
      check(
        !list.has_more && list.data.length <= 1,
        "RECONCILIATION_AMBIGUOUS",
      );
      if (list.data.length) {
        check(identifier(list.data[0].id, "sub"));
        subscriptionCheck(list.data[0], label, list.data[0].id);
        f.subscription = list.data[0].id;
      }
      await save("reconcile-subscription-" + label, "verified");
    },
    async voidFailureInvoice() {
      const f = fixture("f");
      // An observation failure may have occurred before the failed invoice ID
      // was recorded. One scoped list in cleanup prevents treating it as absent.
      if (f.subscription && !f.cleanupInvoicesRead) {
        f.cleanupInvoicesRead = true;
        await api.invoices("f", true);
      }
      if (!f.openInvoice) {
        check(
          !f.subscription || f.paidInvoices === 1,
          "CLEANUP_INVOICE_UNCONFIRMED",
        );
        return;
      }
      const i = await get("stripe", "/v1/invoices/" + f.openInvoice, true);
      check(
        i.id === f.openInvoice &&
          i.customer === f.customer &&
          i.livemode === false &&
          i.parent?.subscription_details?.subscription === f.subscription,
      );
      if (i.status === "void") return;
      check(i.status === "open", "MONTHLY_INVOICE_NOT_OPEN");
      await change(
        "invoiceVoids",
        "invoiceVoids-f",
        async () => {
          const out = await request(
            "stripe",
            "POST",
            `/v1/invoices/${f.openInvoice}/void`,
            {},
            "monthly_void_f",
            true,
          );
          check(
            out.id === f.openInvoice &&
              out.status === "void" &&
              out.livemode === false,
          );
        },
        true,
      );
    },
  };
  return api;
}
