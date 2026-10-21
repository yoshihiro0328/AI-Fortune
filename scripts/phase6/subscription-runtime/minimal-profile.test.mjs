import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./provider-fixture.mjs";
import { MINIMAL_LIMITS, minimalRequest } from "./minimal-profile.mjs";
import { Policy } from "./policy.mjs";
import { observePreflight } from "./journal.mjs";
import { sessionEvidence } from "./evidence.mjs";

test("minimal Auth provisioning leaves profiles empty until application login", async () => {
  const t = await fixture("connected", undefined, true);
  try {
    await t.ops.inspect(await t.ops.observe());
    const m = await t.ops.prepare({
      c: "synthetic-pass-C",
      d: "synthetic-pass-D",
    });
    const read = (p) =>
      t.wire({
        provider: "supabase",
        role: "service",
        path: "/rest/v1/" + p,
        operation: "synthetic_preflight",
      });
    const observed = await observePreflight(m, read);
    for (const user of [m.c, m.d])
      assert.equal(observed["profiles:" + user.id].length, 0);
    const evidence = sessionEvidence({ m, wire: t.wire, save: t.store.save });
    for (const user of [m.c, m.d]) {
      const login = await t.wire({
        provider: "supabase",
        role: "anon",
        method: "POST",
        path: "/auth/v1/token?grant_type=password",
        body: { email: user.email, password: "SyntheticOnly123!" },
        operation: "synthetic_login",
      });
      evidence.accepted({ kind: "login", user: user.id }, login);
    }
    await assert.rejects(evidence.logins(), /LOGIN_PROFILE_NOT_INITIALIZED/);
    for (const user of [m.c, m.d])
      await t.wire({
        provider: "supabase",
        role: "service",
        method: "POST",
        path: "/rest/v1/rpc/claim_anonymous_diagnoses",
        body: { p_user: user.id, p_session: "synthetic-new-session" },
        operation: "synthetic_login_profile",
      });
    assert.equal(await evidence.logins(), true);
    await assert.rejects(
      observePreflight(m, read),
      /PRELOGIN_PROFILE_STATE_MISMATCH/,
    );
    assert.equal((await t.ops.cleanup()).complete, true);
    assert.equal((await t.ops.inspectAfter()).protectedUnchanged, true);
  } finally {
    await t.close();
  }
});

test("minimal sender rejects removed operations before sending", () => {
  for (const [method, path] of [
    ["POST", "/v1/test_helpers/test_clocks"],
    ["GET", "/v1/test_helpers/test_clocks/clock_x"],
    ["POST", "/v1/payment_methods/pm_x/attach"],
    ["POST", "/v1/subscriptions/sub_x"],
    ["POST", "/v1/prices/price_x"],
    ["POST", "/v1/products/prod_x"],
    ["POST", "/v1/invoices/in_x/pay"],
    ["POST", "/v1/invoices/in_x/finalize"],
    ["GET", "/v1/events"],
  ])
    assert.throws(
      () => minimalRequest({ provider: "stripe", method, path }),
      /MINIMAL_OPERATION_DENIED/,
    );
  assert.throws(
    () =>
      minimalRequest({
        provider: "stripe",
        method: "DELETE",
        path: "/v1/subscriptions/sub_x",
        body: { invoice_now: true, prorate: false },
      }),
    /CANCEL_CHARGES_DENIED/,
  );
});

test("minimal caps and closure preserve catalog without Clock or method APIs", async () => {
  const t = await fixture("normal", undefined, true);
  try {
    await t.ops.inspect(await t.ops.observe());
    const prepared = await t.ops.prepare({
      c: "synthetic-pass-C",
      d: "synthetic-pass-D",
    });
    assert.equal(prepared.clock, null);
    assert(!t.objects.clock);
    const p = new Policy(prepared);
    assert.equal(p.contractLimit, 1);
    assert.equal(p.invoiceLimit, 1);
    p.once("checkout", p.contractLimit);
    assert.throws(() => p.once("checkout", p.contractLimit), /OPERATION_LIMIT/);
    t.ops.reserveRuntime("checkout", 1);
    assert.throws(() => t.ops.reserveRuntime("checkout", 2), /OPERATION_LIMIT/);
    t.ops.reserveRuntime("portal", 1);
    assert.throws(() => t.ops.reserveRuntime("portal", 2), /OPERATION_LIMIT/);
    assert.throws(
      () => t.ops.reserveRuntime("cancel:/v1/subscriptions/sub_x", 1),
      /OPERATION_LIMIT/,
    );
    for (const k of [
      "createClock",
      "advanceClock",
      "setFailingMethod",
      "setGoodMethod",
      "duplicate",
      "outOfOrder",
    ])
      assert.equal(MINIMAL_LIMITS[k], 0);
    const out = await t.ops.cleanup();
    assert(out.complete);
    assert.equal(t.objects.price.active, true);
    await t.ops.inspectAfter();
    assert.equal(
      t.calls.filter(
        (c) => c.p.includes("test_clock") || c.p.includes("payment_methods"),
      ).length,
      0,
    );
  } finally {
    await t.close();
  }
});

for (const mode of ["permission", "unknown", "cleanup-fail"])
  test(
    "minimal preparation stops and independent cleanup: " + mode,
    async () => {
      const t = await fixture(mode, undefined, true);
      try {
        await t.ops.inspect(await t.ops.observe());
        if (mode === "cleanup-fail")
          await t.ops.prepare({ c: "synthetic-pass-C", d: "synthetic-pass-D" });
        else
          await assert.rejects(
            t.ops.prepare({ c: "synthetic-pass-C", d: "synthetic-pass-D" }),
          );
        const out = await t.ops.cleanup();
        assert.equal(out.complete, false);
        assert.equal(
          t.calls.filter((c) => c.p === "/v1/customers" && c.method === "POST")
            .length,
          1,
        );
        assert.equal(t.objects.price.active, true);
        assert.equal(out.deactivateDatabasePrice, "verified");
        assert.equal(
          t.calls.filter(
            (c) =>
              c.p.includes("test_clock") || c.p.includes("payment_methods"),
          ).length,
          0,
        );
      } finally {
        await t.close();
      }
    },
  );

test("minimal unknown cancellation is read back, never resent, other cleanup continues", async () => {
  const t = await fixture("normal", undefined, true);
  try {
    await t.ops.inspect(await t.ops.observe());
    await t.ops.prepare({ c: "synthetic-pass-C", d: "synthetic-pass-D" });
    t.objects.sub_minimal = {
      id: "sub_minimal",
      customer: "cus_http",
      livemode: false,
      status: "active",
      metadata: { user_id: t.m.c.id },
      items: { data: [{ price: { id: t.m.price } }] },
    };
    t.objects.cs_test_minimal = {
      id: "cs_test_minimal",
      customer: "cus_http",
      livemode: false,
      mode: "subscription",
      amount_total: 980,
      currency: "jpy",
      metadata: { user_id: t.m.c.id },
      subscription: "sub_minimal",
      status: "complete",
      payment_status: "paid",
    };
    await t.ops.bindCheckout("cs_test_minimal");
    t.objects.dropCancelResponse = true;
    await assert.rejects(
      t.ops.endSubscription("sub_minimal"),
      /RESULT_UNKNOWN_STOP/,
    );
    const result = await t.ops.cleanup();
    assert.equal(t.objects.sub_minimal.status, "canceled");
    assert.equal(
      t.calls.filter(
        (c) => c.p === "/v1/subscriptions/sub_minimal" && c.method === "DELETE",
      ).length,
      1,
    );
    assert.equal(result.deactivateDatabasePrice, "verified");
    assert.equal(result.restorePortalBinding, "verified");
    assert.equal(result.complete, false); // unknown operation retained, never rewritten as success
  } finally {
    await t.close();
  }
});
