// Explicit credential-free macOS preflight: actual app/broker/SQL, synthetic provider only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { isolatedSubscription } from "./isolated.mjs";
import { startRuntime } from "./runtime.mjs";
import { TARGET } from "./policy.mjs";
const [report] = process.argv.slice(2);
assert(path.isAbsolute(report) && !fs.existsSync(report));
const realFetch = fetch;
globalThis.fetch = (url, options) => {
  assert(
    [TARGET.app, TARGET.broker].includes(
      new URL(url instanceof Request ? url.url : url).origin,
    ),
  );
  return realFetch(url, options);
};
const checks = [];
for (const mode of ["renewal-end", "failure"]) {
  const db = await isolatedSubscription();
  const before = await db.protectedState();
  db.m.scenario = "remaining-monthly-v1";
  db.m.portal = null;
  await db.pg.query("update price_versions set active=false where id=$1", [
    db.m.version,
  ]);
  const receipts = [];
  let rt;
  try {
    rt = await startRuntime({
      m: db.m,
      transport: db.transport,
      evidence: {
        accepted() {},
        delivered(raw) {
          const e = JSON.parse(raw);
          receipts.push({ id: e.id, type: e.type });
        },
      },
    });
    assert.equal(
      (await fetch(TARGET.app + "/subscription-test/c")).status,
      200,
    );
    // Seed one local provider subscription without opening any real or synthetic checkout UI.
    db.checkouts.set("cs_fixture", { id: "cs_fixture", status: "open" });
    const sub = db.pay("cs_fixture");
    sub.metadata.run = db.m.run;
    let n = 0;
    async function deliver(type, object) {
      const id = "evt_monthly" + ++n,
        raw = JSON.stringify({
          id,
          type,
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          account: TARGET.account,
          data: { object: structuredClone(object) },
        });
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload: raw,
        secret: rt.secret,
      });
      const response = await fetch(TARGET.broker + "/webhook", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: raw,
      });
      assert.equal(response.status, 200, "signed handler must commit");
      assert(receipts.some((e) => e.id === id));
      const committed = await db.pg.query(
        "select event_type from stripe_events where stripe_event_id=$1",
        [id],
      );
      assert.equal(committed.rows[0]?.event_type, type);
      return id;
    }
    const entitlement = async () =>
      (
        await db.pg.query("select consultation_entitlement($1) as v", [
          db.m.c.id,
        ])
      ).rows[0].v;
    const initial = db.invoices.get(sub.id)[0];
    initial.lines.data[0].period.end = Math.floor(Date.now() / 1000) - 5;
    await deliver("invoice.paid", initial);
    assert.equal((await entitlement()).plan, "free");
    if (mode === "renewal-end") {
      db.transition(sub.id, "renewed");
      await deliver("invoice.paid", db.invoices.get(sub.id).at(-1));
      assert.equal((await entitlement()).plan, "plus");
      sub.cancel_at_period_end = true;
      await deliver("customer.subscription.updated", sub);
      assert.equal((await entitlement()).plan, "plus");
      db.transition(sub.id, "ended");
      await deliver("customer.subscription.deleted", sub);
      assert.equal((await entitlement()).plan, "free");
    } else {
      db.transition(sub.id, "failed");
      await deliver("invoice.payment_failed", db.invoices.get(sub.id).at(-1));
      assert.equal((await entitlement()).plan, "free");
      db.transition(sub.id, "ended");
      await deliver("customer.subscription.deleted", sub);
      assert.equal((await entitlement()).plan, "free");
    }
    assert.equal(
      rt.policy.writers.every((w) => w.source === "webhook"),
      true,
    );
    assert.equal(await db.protectedState(), before);
    checks.push({
      mode,
      actualHandler: true,
      realProvider: false,
      allCommitted: true,
      protectedUnchanged: true,
    });
  } finally {
    await rt?.stop();
    assert(!rt || !fs.existsSync(rt.dir));
    await db.close();
  }
}
fs.writeFileSync(
  report,
  JSON.stringify({
    checks,
    isolated: true,
    processesStopped: true,
    credentialsUsed: false,
  }) + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  "PASS monthly actual application, signed handler, SQL and process cleanup (isolated)",
);
