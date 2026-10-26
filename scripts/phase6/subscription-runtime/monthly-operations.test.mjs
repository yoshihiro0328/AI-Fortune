import test from "node:test";
import assert from "node:assert/strict";
import {
  monthlyOperations,
  initialClockTime,
  MONTHLY_PRICE,
  MONTHLY_PRODUCT,
  MONTHLY_VERSION,
} from "./monthly-operations.mjs";
import { MonthlyPolicy } from "./monthly-policy.mjs";
import { TARGET } from "./policy.mjs";
const run = "10000000-0000-4000-8000-000000000001";
const users = Object.fromEntries(
  ["e", "f"].map((k, n) => {
    const id = `20000000-0000-4000-8000-00000000000${n + 1}`;
    return [
      k,
      {
        id,
        email: `plus-${run}-${id}@example.com`,
        password: "Synthetic-password-ONLY1",
      },
    ];
  }),
);
const price = {
  id: MONTHLY_PRICE,
  product: MONTHLY_PRODUCT,
  unit_amount: 980,
  currency: "jpy",
  active: true,
  livemode: false,
  recurring: { interval: "month", interval_count: 1 },
};
function fixture({
  fail,
  checkpointFail = false,
  signal,
  advanceLag = 0,
  invalidAdvanceResponse = false,
  neverReady = false,
} = {}) {
  let clockTime = Date.parse("2026-10-26T04:00:00Z"),
    calls = [],
    saved = [],
    clocks = {},
    customers = {},
    subscriptions = {};
  const now = () => clockTime;
  const wire = async (r) => {
    calls.push(structuredClone({ ...r, signal: undefined }));
    if (fail?.(r)) throw Error("synthetic-sensitive-response");
    const label = r.operation.includes("_f") ? "f" : "e";
    if (r.path === "/v1/account") return { id: TARGET.account };
    if (r.path.startsWith("/rest/v1/payment_environment"))
      return [{ mode: "sandbox", stripe_account_id: TARGET.account }];
    if (r.path.startsWith("/rest/v1/price_versions"))
      return [{ id: MONTHLY_VERSION, active: false, is_test: true }];
    if (r.path === "/v1/prices/" + MONTHLY_PRICE) return price;
    if (r.path === "/auth/v1/admin/users")
      return { ...r.body, email_confirmed_at: "2026-10-26" };
    if (r.path.startsWith("/rest/v1/profiles"))
      return r.method === "GET" ? [] : [r.body];
    if (r.path === "/rest/v1/billing_customers") return [r.body];
    if (r.path === "/v1/test_helpers/test_clocks")
      return (clocks["clock_" + label] = {
        id: "clock_" + label,
        livemode: false,
        status: "ready",
        frozen_time: r.body.frozen_time,
      });
    if (r.path.includes("test_clocks/")) {
      let id = r.path.split("/")[4],
        c = clocks[id];
      if (r.method === "POST" && advanceLag) {
        c.pending = r.body.frozen_time;
        c.reads = advanceLag;
        c.status = "advancing";
        return {
          ...c,
          ...(invalidAdvanceResponse ? { id: "clock_wrong" } : {}),
        };
      }
      if (r.method === "POST") c.frozen_time = r.body.frozen_time;
      if (r.method === "GET" && c.pending && !neverReady && --c.reads < 0) {
        c.frozen_time = c.pending;
        delete c.pending;
        c.status = "ready";
      }
      return { ...c };
    }
    if (r.path === "/v1/customers")
      return (customers["cus_" + label] = {
        ...r.body,
        id: "cus_" + label,
        livemode: false,
      });
    if (r.path.includes("payment_methods/"))
      return {
        id: "pm_" + (r.path.includes("Fail") ? "failure" : label),
        livemode: false,
        customer: r.body.customer,
      };
    if (r.path === "/v1/subscriptions" && r.method === "POST") {
      const end = Math.floor(now() / 1000) - 7200;
      return (subscriptions["sub_" + label] = {
        ...r.body,
        id: "sub_" + label,
        livemode: false,
        test_clock: customers[r.body.customer].test_clock,
        status: "active",
        items: { data: [{ price, quantity: 1, current_period_end: end }] },
      });
    }
    if (r.path.startsWith("/v1/subscriptions/")) {
      const s = subscriptions[r.path.split("/")[3]];
      if (r.method === "DELETE") s.status = "canceled";
      if (r.method === "POST") Object.assign(s, r.body);
      return structuredClone(s);
    }
    throw Error("UNEXPECTED_FIXTURE_ROUTE");
  };
  const ops = monthlyOperations({
    run,
    users,
    signal,
    now,
    deadline: now() + 1200000,
    wire,
    checkpoint: async (s) => {
      if (checkpointFail) throw Error("disk");
      saved.push(s);
    },
    sleep: async (ms) => {
      clockTime += ms;
    },
  });
  return { ops, calls, saved, now, subscriptions };
}
test("calendar months clamp leap year and end of month", () => {
  assert.equal(
    new Date(
      initialClockTime(Date.parse("2024-03-31T12:00:00Z") / 1000) * 1000,
    ).toISOString(),
    "2024-02-29T10:00:00.000Z",
  );
  assert.equal(
    new Date(
      initialClockTime(Date.parse("2026-01-31T12:00:00Z") / 1000) * 1000,
    ).toISOString(),
    "2025-12-31T10:00:00.000Z",
  );
});
test("two fresh targets, fixed body/roles, no catalog/settings/old-user writes", async () => {
  const { ops, calls } = fixture();
  await ops.identify();
  for (const k of ["e", "f"]) {
    await ops.prepare(k);
    await ops.attach(k);
    await ops.createSubscription(k);
  }
  assert.equal(ops.state().fixtures.e.subscription, "sub_e");
  assert.equal(
    calls.filter((c) => c.path === "/v1/subscriptions" && c.method === "POST")
      .length,
    2,
  );
  assert.ok(
    calls
      .filter((c) => c.method !== "GET")
      .every(
        (c) =>
          !c.path.includes("price") &&
          !c.path.includes("settings") &&
          !c.path.includes("checkout") &&
          !c.path.includes("portal"),
      ),
  );
  await assert.rejects(ops.createSubscription("e"));
  await ops.beginCleanup();
  await ops.closeSubscription("e");
  await ops.closeSubscription("f");
  for (const c of calls.filter((c) => c.method === "DELETE"))
    assert.deepEqual(c.body, { prorate: false, invoice_now: false });
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 2);
});
test("unknown mutation consumes reservation, cannot resend, independent cleanup still permitted", async () => {
  const { ops, calls } = fixture({
    fail: (r) => r.operation === "monthly_subscription_f",
  });
  await ops.identify();
  for (const k of ["e", "f"]) {
    await ops.prepare(k);
    await ops.attach(k);
  }
  await ops.createSubscription("e");
  await assert.rejects(
    ops.createSubscription("f"),
    /^Error: MONTHLY_WRITE_UNKNOWN_NO_RESEND$/,
  );
  await assert.rejects(ops.createSubscription("f"));
  assert.equal(
    calls.filter((c) => c.operation === "monthly_subscription_f").length,
    1,
  );
  await ops.beginCleanup();
  await ops.closeSubscription("e");
  assert.equal(
    calls.filter((c) => c.operation === "monthly_cleanup_e").length,
    1,
  );
});
test("checkpoint failure before provisioning prevents outbound write", async () => {
  const { ops, calls } = fixture({ checkpointFail: true });
  await assert.rejects(ops.identify());
  await assert.rejects(ops.prepare("e"));
  assert.equal(calls.filter((c) => c.method !== "GET").length, 0);
});
test("Clock cannot cross a second renewal, or advance failure without switching method", async () => {
  const { ops, now, calls } = fixture();
  await ops.identify();
  for (const k of ["e", "f"]) {
    await ops.prepare(k);
    await ops.attach(k);
    await ops.createSubscription(k);
  }
  await assert.rejects(
    ops.advance("e", Math.floor(now() / 1000) + 86400),
    /SECOND_RENEWAL/,
  );
  await assert.rejects(
    ops.advance("f", Math.floor(now() / 1000) - 3600),
    /FAILURE_PERIOD/,
  );
  assert.equal(calls.filter((c) => c.path.endsWith("/advance")).length, 0);
  await ops.advance("e", Math.floor(now() / 1000) - 7200);
  await ops.advance("e", Math.floor(now() / 1000) - 3600);
  assert.equal(ops.state().fixtures.e.advances, 2);
});
test("advancing response and polling retain old frozen time until ready; POST is not repeated", async () => {
  const { ops, now, calls } = fixture({ advanceLag: 2 });
  await ops.identify();
  await ops.prepare("e");
  await ops.attach("e");
  await ops.createSubscription("e");
  const target = Math.floor(now() / 1000) - 7200;
  await ops.advance("e", target);
  assert.equal(ops.state().fixtures.e.frozen, target);
  assert.equal(ops.state().fixtures.e.pending, undefined);
  assert.equal(calls.filter((r) => r.path.endsWith("/advance")).length, 1);
});
test("uncertain advance is never resent; cleanup waits for ready before its sole cancellation", async () => {
  const { ops, now, calls } = fixture({
    advanceLag: 2,
    invalidAdvanceResponse: true,
  });
  await ops.identify();
  await ops.prepare("e");
  await ops.attach("e");
  await ops.createSubscription("e");
  await assert.rejects(
    ops.advance("e", Math.floor(now() / 1000) - 7200),
    /WRITE_UNKNOWN/,
  );
  await ops.beginCleanup();
  await ops.closeSubscription("e");
  assert.equal(calls.filter((r) => r.path.endsWith("/advance")).length, 1);
  const cancel = calls.findIndex((r) => r.method === "DELETE");
  assert.ok(cancel > 0);
  assert.equal(
    calls
      .slice(0, cancel)
      .filter(
        (r) => r.path.includes("test_clocks/clock_e") && r.method === "GET",
      ).length,
    4,
  );
  assert.equal(calls.filter((r) => r.method === "DELETE").length, 1);
});
test("cleanup never cancels while clock remains advancing or extends its time allowance", async () => {
  const { ops, now, calls } = fixture({
    advanceLag: 2,
    invalidAdvanceResponse: true,
    neverReady: true,
  });
  await ops.identify();
  await ops.prepare("e");
  await ops.attach("e");
  await ops.createSubscription("e");
  await assert.rejects(
    ops.advance("e", Math.floor(now() / 1000) - 7200),
    /WRITE_UNKNOWN/,
  );
  await ops.beginCleanup();
  const before = now();
  await assert.rejects(ops.closeSubscription("e"), /CLEANUP_CLOCK_NOT_READY/);
  assert.ok(now() - before <= 30000);
  assert.equal(calls.filter((r) => r.method === "DELETE").length, 0);
});
test("app policy blocks non-webhook snapshots and every Stripe mutation", () => {
  const m = {
    project: TARGET.ref,
    account: TARGET.account,
    app: TARGET.app,
    amount: 980,
    currency: "jpy",
    interval: "month",
    run,
    c: { ...users.e, email: "synthetic@example.invalid" },
    d: users.f,
    protectedUsers: [
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ],
    customer: "cus_e",
    clock: "clock_e",
    price: MONTHLY_PRICE,
    product: MONTHLY_PRODUCT,
    portal: null,
    version: MONTHLY_VERSION,
    scenario: "remaining-monthly-v1",
    synthetic: true,
  };
  const p = new MonthlyPolicy(m);
  assert.throws(
    () =>
      p.authorize({
        url: TARGET.stripe + "/v1/subscriptions/sub_e",
        method: "POST",
        body: "cancel_at_period_end=true",
      }),
    /MONTHLY_APP_WRITE_DENIED/,
  );
  assert.throws(
    () =>
      p.authorize({
        url: TARGET.supabase + "/rest/v1/rpc/apply_subscription_snapshot",
        method: "POST",
        body: JSON.stringify({
          p_event: null,
          p_snapshot: { status: "active" },
        }),
      }),
    /DIRECT_WRITER_DENIED/,
  );
  assert.equal(p.writers.length, 0);
});

test("interruption forbids new mutations but preserves bounded cancellation", async () => {
  const control = new AbortController(),
    t = fixture({ signal: control.signal });
  await t.ops.identify();
  await t.ops.prepare("e");
  await t.ops.attach("e");
  await t.ops.createSubscription("e");
  control.abort();
  await assert.rejects(t.ops.prepare("f"));
  await t.ops.beginCleanup();
  await t.ops.closeSubscription("e");
  assert.equal(t.calls.filter((c) => c.method === "DELETE").length, 1);
  assert.equal(
    t.calls.filter((c) => c.operation === "monthly_user_f").length,
    0,
  );
});
