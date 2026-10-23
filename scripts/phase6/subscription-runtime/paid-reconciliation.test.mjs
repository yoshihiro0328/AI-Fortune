import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./provider-fixture.mjs";
import { providerOperations } from "./provider-ops.mjs";

for (const failure of [
  "TRANSPORT_FAILED",
  "permission_missing",
  "persistent",
  "aborted",
])
  test("known paid confirmation: " + failure, async () => {
    const t = await fixture("normal", undefined, true);
    let reads = 0;
    const ops = providerOperations({
      m: t.m,
      attemptId: randomUUID(),
      save: t.store.save,
      signal: t.abort.signal,
      human: {},
      wire: async (r) => {
        if (r.operation === "observe_subscription") {
          reads++;
          if (reads === 1 || failure === "persistent") {
            if (failure === "aborted") t.abort.abort();
            throw Error(
              failure === "permission_missing" ? failure : "TRANSPORT_FAILED",
            );
          }
        }
        return t.wire(r);
      },
    });
    try {
      await ops.inspect(await ops.observe());
      await ops.prepare({ c: "SyntheticOnly123!", d: "SyntheticOnly123!" });
      t.objects.sub_paid = {
        id: "sub_paid",
        customer: "cus_http",
        livemode: false,
        status: "active",
        metadata: { user_id: t.m.c.id },
        items: { data: [{ price: { id: t.m.price } }] },
      };
      t.objects.cs_test_paid = {
        id: "cs_test_paid",
        customer: "cus_http",
        livemode: false,
        mode: "subscription",
        currency: "jpy",
        amount_total: 980,
        metadata: { user_id: t.m.c.id },
        status: "complete",
        payment_status: "paid",
        subscription: "sub_paid",
      };
      t.objects.invoices = [
        {
          id: "in_paid",
          customer: "cus_http",
          livemode: false,
          parent: { subscription_details: { subscription: "sub_paid" } },
          currency: "jpy",
          total: 980,
          status: "paid",
          attempt_count: 1,
        },
      ];
      await ops.bindCheckout("cs_test_paid");
      if (failure === "TRANSPORT_FAILED") {
        assert.equal(
          (await ops.inspectSubscription("sub_paid")).subscription.id,
          "sub_paid",
        );
        assert.equal(ops.state().stopped, false);
      } else {
        await assert.rejects(ops.inspectSubscription("sub_paid"));
        assert.equal(ops.state().stopped, true);
      }
      assert.equal(
        reads,
        ["persistent", "TRANSPORT_FAILED"].includes(failure) ? 2 : 1,
      );
      assert.equal(
        t.calls.filter(
          (c) => c.p === "/v1/checkout/sessions" && c.method === "POST",
        ).length,
        0,
      );
    } finally {
      await t.close();
    }
  });
