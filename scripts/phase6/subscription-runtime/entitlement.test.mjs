import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedSubscription } from "./isolated.mjs";
test("17-migration DB entitlement boundary states, quota and retained data", async () => {
  const d = await isolatedSubscription(),
    p = d.pg,
    m = d.m,
    before = await d.protectedState();
  try {
    await p.query(
      `insert into subscriptions(id,user_id,stripe_customer_id,price_version,amount,status,period_start,period_end,paid_through,is_test,created_at) values('sub_entitlement',$1,$2,$3,980,'active',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days',true,now())`,
      [m.c.id, m.customer, m.version],
    );
    const usage = async () =>
      (await p.query("select consultation_entitlement($1) v", [m.c.id])).rows[0]
        .v;
    for (const [status, plan] of [
      ["active", "plus"],
      ["past_due", "plus"],
      ["unpaid", "free"],
      ["trialing", "free"],
      ["incomplete", "free"],
      ["incomplete_expired", "free"],
      ["paused", "free"],
      ["canceled", "free"],
    ]) {
      await p.query("update subscriptions set status=$1 where id=$2", [
        status,
        "sub_entitlement",
      ]);
      const u = await usage();
      assert.equal(u.plan, plan, status);
      assert.equal(u.limit, plan === "plus" ? 30 : 3);
    }
    await p.exec(
      "update subscriptions set status='active',cancel_at_period_end=true",
    );
    assert.equal((await usage()).plan, "plus");
    await p.exec(
      "update subscriptions set paid_through=now()-interval '1 second'",
    );
    assert.equal((await usage()).plan, "free");
    await p.exec(
      "update subscriptions set paid_through=period_end,period_start=now()+interval '1 day'",
    );
    assert.equal((await usage()).plan, "free");
    await p.exec(
      "update subscriptions set period_start=now()-interval '1 day',cancel_at=now()-interval '1 second'",
    );
    assert.equal((await usage()).plan, "free");
    assert.equal(await d.protectedState(), before);
  } finally {
    await d.close();
  }
});
