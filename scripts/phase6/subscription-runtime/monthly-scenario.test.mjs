import test from "node:test";
import assert from "node:assert/strict";
import { monthlyScenario } from "./monthly-scenario.mjs";
function fixture(failAt) {
  const calls = [],
    records = [],
    fixtures = { e: { frozen: 1, advances: 0 }, f: { frozen: 1, advances: 0 } };
  let time = 1793000000000,
    phase = { e: 0, f: 0 },
    cleanup = false,
    stopCount = 0;
  const boundary = time / 1000 - 7200;
  const step = (name) => {
    calls.push(name);
    if (name === failAt) throw Error("synthetic-only");
  };
  const ops = {
    state: () => ({ fixtures }),
    identify: async () => step("identify"),
    prepare: async (k) => step("prepare-" + k),
    attach: async (k) => step("attach-" + k),
    createSubscription: async (k) => step("create-" + k),
    subscription: async (k) => ({
      status: phase[k] >= 3 ? "canceled" : "active",
      items: {
        data: [
          { current_period_end: phase[k] ? boundary + 30 * 86400 : boundary },
        ],
      },
    }),
    invoices: async (k) =>
      phase[k]
        ? [
            { status: "paid" },
            {
              status: k === "f" ? "open" : "paid",
              next_payment_attempt: null,
              attempt_count: 1,
            },
          ]
        : [{ status: "paid" }],
    advance: async (k, target) => {
      step("advance-" + k);
      fixtures[k].frozen = target;
      fixtures[k].advances++;
      phase[k]++;
      fixtures[k].periodEnd = boundary + 30 * 86400;
    },
    scheduleEnd: async () => step("schedule-e"),
    switchFailureMethod: async () => step("switch-f"),
    beginCleanup: async () => {
      cleanup = true;
      step("begin-cleanup");
    },
    reconcileUnknownSubscription: async (k) => {
      assert(cleanup);
      step("reconcile-" + k);
    },
    closeSubscription: async (k) => {
      assert(cleanup);
      step("close-" + k);
    },
    voidFailureInvoice: async () => {
      assert(cleanup);
      step("void-f");
    },
  };
  return {
    calls,
    records,
    run: () =>
      monthlyScenario({
        ops,
        now: () => time,
        deadline: time + 1200000,
        start: async (k) => {
          step("start-" + k);
          return k;
        },
        stop: async (k) => {
          stopCount++;
          step("stop-" + k);
        },
        record: async (k, v) => records.push({ k, v }),
        observe: async (k, type, expected) => {
          step("observe-" + k + "-" + type);
          return {
            kind: "isolated",
            eventType: type,
            sameEvent: true,
            signatureVerified: true,
            httpStatus: 200,
            committed: true,
            noOtherWriter: true,
            receivedAt: time,
            observedAt: time,
            plan: expected.plan ?? "free",
            invoiceCount: expected.paidInvoices ?? 2,
            state: {
              id: "sub_" + k,
              status: expected.status ?? "active",
              paid_through: new Date(
                time + (k === "e" && phase[k] ? 10000 : 0),
              ).toISOString(),
            },
          };
        },
      }),
    get stopCount() {
      return stopCount;
    },
  };
}
test("whole E/F flow reaches strict webhook verdict and independent cleanup without another purchase", async () => {
  const t = fixture(),
    r = await t.run();
  assert.equal(r.renewal.verified, true);
  assert.equal(r.periodEnd.verified, true);
  assert.equal(r.failure.verified, true);
  assert.equal(r.retryExhaustion.verified, false); // no next_payment_attempt: do not invent retries
  assert.equal(t.calls.filter((x) => x.startsWith("create-")).length, 2);
  assert.equal(t.calls.filter((x) => x.startsWith("advance-")).length, 5);
  assert.equal(t.stopCount, 2);
  assert.deepEqual(r.cleanup, {
    e: "canceled_or_not_created",
    f: "canceled_or_not_created",
    invoice: "void_or_none",
    processes: "stopped",
  });
});
test("unknown payment-confirmation observation never repeats contract creation, cleanup still runs", async () => {
  const t = fixture("observe-e-invoice.paid"),
    r = await t.run();
  assert.equal(r.stopped, true);
  assert.equal(t.calls.filter((x) => x === "create-e").length, 1);
  assert(!t.calls.includes("create-f"));
  assert(t.calls.includes("close-e"));
  assert(t.calls.includes("close-f"));
  assert(t.calls.includes("void-f"));
  assert.equal(t.stopCount, 1);
});
test("cleanup journal failure does not skip independent close, void and process stop", async () => {
  const t = fixture("begin-cleanup"),
    r = await t.run();
  assert.equal(r.cleanup.journal, "unconfirmed");
  assert.equal(r.cleanup.e, "canceled_or_not_created");
  assert.equal(r.cleanup.f, "canceled_or_not_created");
  assert.equal(t.stopCount, 2);
});
test("one close failure does not skip other close, invoice or process cleanup", async () => {
  const t = fixture("close-e"),
    r = await t.run();
  assert.equal(r.cleanup.e, "unconfirmed");
  assert.equal(r.cleanup.f, "canceled_or_not_created");
  assert.equal(r.cleanup.invoice, "void_or_none");
  assert.equal(r.cleanup.processes, "stopped");
});
