import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  seedPaidHistory,
  retainedRecords,
} from "./provider-fixture.mjs";
import { retainedPlan } from "./retained-plan.mjs";
import { Policy, TARGET } from "./policy.mjs";
import { paymentHistory } from "./history.mjs";

test("retained paid history is read-only, separate from one new contract/invoice, and exact", async () => {
  const t = await fixture("normal", undefined, true, true);
  try {
    const h = await seedPaidHistory(t);
    const input = await retainedRecords(t);
    const plan = retainedPlan(input),
      p = new Policy(plan.manifest);
    assert.deepEqual(paymentHistory(plan.manifest), h);
    const get = (path) =>
      p.authorize({ method: "GET", url: TARGET.stripe + path, headers: {} });
    p.accept(
      get("/v1/subscriptions/" + h.subscription),
      200,
      t.objects.sub_history,
    );
    p.accept(
      get("/v1/invoices?subscription=" + h.subscription + "&limit=24"),
      200,
      { has_more: false, data: t.objects.invoices },
    );
    assert.equal(p.ids.size, 0);
    assert.equal(p.invoiceIds.size, 0);
    p.accept({ kind: "subscription" }, 200, {
      ...t.objects.sub_history,
      id: "sub_new",
      status: "active",
      ended_at: null,
    });
    assert.equal(p.ids.size, 1);
    assert.throws(
      () =>
        p.accept({ kind: "subscription" }, 200, {
          ...t.objects.sub_history,
          id: "sub_extra",
        }),
      /SCOPE_DENIED/,
    );
    assert.throws(() =>
      p.authorize({
        method: "DELETE",
        url: TARGET.stripe + "/v1/subscriptions/" + h.subscription,
        headers: {},
      }),
    );
    assert.throws(
      () =>
        p.signed(
          {
            type: "customer.subscription.deleted",
            livemode: false,
            data: { object: t.objects.sub_history },
          },
          "synthetic",
        ),
      /HISTORICAL_EVENT_DENIED/,
    );
    assert.throws(
      () =>
        new Policy({
          ...plan.manifest,
          resume: {
            ...plan.manifest.resume,
            approval: {
              ...plan.manifest.resume.approval,
              recontractOnce: false,
            },
          },
        }),
    );
    assert.throws(
      () =>
        p.accept({ kind: "subscription" }, 200, {
          ...t.objects.sub_history,
          status: "active",
        }),
      /HISTORICAL_SUBSCRIPTION_CHANGED/,
    );
    assert.throws(
      () =>
        p.accept({ kind: "invoices", subscription: h.subscription }, 200, {
          has_more: false,
          data: [{ ...t.objects.invoices[0], amount_remaining: 1 }],
        }),
      /HISTORICAL_INVOICE_CHANGED/,
    );
  } finally {
    await t.close();
  }
});

test("paid-closure reconciliation cannot hide extra unknowns or an unsafe invoice", async () => {
  const t = await fixture("normal", undefined, true, true);
  try {
    const h = await seedPaidHistory(t),
      input = await retainedRecords(t);
    input.closure.completion.closure = {
      complete: false,
      unresolvedOperations: 1,
      ...Object.fromEntries(
        [
          "stopProcesses",
          "endContracts",
          "deactivatePrice",
          "restorePortalBinding",
          "revokeKeys",
          "eraseTemporary",
        ].map((k) => [k, "verified"]),
      ),
    };
    input.closure.paidReconciliation = {
      sourceAttemptId: input.priorPlan.attemptId,
      protectedBaselineUnchanged: true,
      databaseSubscriptions: 0,
      databaseInvoices: 0,
      subscription: h.subscription,
      subscriptionStatus: "canceled",
      invoice: h.invoice,
      invoiceCount: 1,
      hasMore: false,
      invoiceStatus: "paid",
      amountPaid: 980,
      amountRemaining: 0,
      currency: "jpy",
      test: true,
      source: "bounded-read-reconciliation",
    };
    assert(retainedPlan(input));
    for (const mutate of [
      (x) => (x.closure.completion.closure.unresolvedOperations = 2),
      (x) => (x.closure.paidReconciliation.amountRemaining = 980),
      (x) => (x.closure.paidReconciliation.subscriptionStatus = "active"),
      (x) => (x.closure.revocation.api.app = "unknown"),
    ]) {
      const bad = structuredClone(input);
      mutate(bad);
      assert.throws(() => retainedPlan(bad));
    }
  } finally {
    await t.close();
  }
});

test("only the exact canceled C history is allowed as retained database state", async () => {
  const { retainedUserRows } = await import("./history.mjs");
  const t = await fixture("normal", undefined, true, true);
  try {
    const h = await seedPaidHistory(t);
    const s = {
      id: h.subscription,
      user_id: t.m.c.id,
      is_test: true,
      status: "canceled",
      ended_at: new Date(h.endedAt * 1000).toISOString(),
      stripe_customer_id: t.m.customer,
      price_version: t.m.version,
      amount: 980,
    };
    const i = {
      id: h.invoice,
      subscription_id: h.subscription,
      user_id: t.m.c.id,
      status: "paid",
      amount: 980,
      currency: "jpy",
      is_test: true,
    };
    assert(retainedUserRows(t.m, "subscriptions", t.m.c.id, [s]));
    assert(retainedUserRows(t.m, "subscription_invoices", t.m.c.id, [i]));
    for (const change of [
      { id: "sub_other" },
      { status: "active" },
      { is_test: false },
      { user_id: t.m.d.id },
      { amount: 981 },
      { ended_at: null },
      { stripe_customer_id: "cus_other" },
      { price_version: "other" },
    ])
      assert.equal(
        retainedUserRows(t.m, "subscriptions", t.m.c.id, [{ ...s, ...change }]),
        false,
      );
    for (const change of [
      { id: "in_other" },
      { subscription_id: "sub_other" },
      { status: "open" },
      { amount: 0 },
      { currency: "usd" },
      { is_test: false },
    ])
      assert.equal(
        retainedUserRows(t.m, "subscription_invoices", t.m.c.id, [
          { ...i, ...change },
        ]),
        false,
      );
    assert.equal(retainedUserRows(t.m, "subscriptions", t.m.d.id, [s]), false);
    assert.equal(
      retainedUserRows(t.m, "subscriptions", t.m.c.id, [s, s]),
      false,
    );
    assert.equal(retainedUserRows(t.m, "payments", t.m.c.id, [i]), false);
    assert.equal(retainedUserRows(t.m, "subscriptions", t.m.c.id, null), false);
  } finally {
    await t.close();
  }
});
