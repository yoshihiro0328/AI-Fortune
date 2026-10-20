import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedPaid } from "./isolated.mjs";
import {
  eventCount,
  validatePaid,
  bodySql,
  snapshot,
  verifyAfter,
  reportBody,
  compareBaseline,
} from "./state.mjs";
import {
  ContinuationPolicy,
  supabaseTransport,
  safeRequest,
} from "./network.mjs";
import { TARGET } from "../payment-runtime/policy.mjs";
const body = reportBody(process.cwd());
test("real 17-migration schema: old metadata lookup fails, corrected lookup passes and exact completed SQL updates only paid_reports", async () => {
  const db = await isolatedPaid();
  try {
    assert.equal(
      db.baseline.analytics_events.filter(
        (x) =>
          x.event_name === "payment_completed" &&
          x.diagnosis_id === db.m.diagnosis,
      ).length,
      0,
    );
    assert.equal(
      eventCount(
        db.baseline.analytics_events,
        "payment_completed",
        db.m.diagnosis,
      ),
      1,
    );
    const sql = bodySql(db.m, db.baseline, db.expected, body);
    assert(sql.includes("DO $continuation$"));
    await db.pg.exec(sql);
    const after = await snapshot(db.read);
    validatePaid(db.m, after, db.expected, body);
    verifyAfter(db.baseline, after, body);
    await assert.rejects(db.pg.exec(sql));
    await db.pg.exec("rollback");
    verifyAfter(db.baseline, await snapshot(db.read), body);
  } finally {
    await db.close();
  }
});
for (const change of [
  "owner",
  "payment",
  "duplicate-event",
  "price",
  "body",
  "fixture",
])
  test("preflight refuses " + change, async () => {
    const db = await isolatedPaid();
    try {
      const s = structuredClone(db.baseline);
      if (change === "owner") s.diagnoses[0].user_id = db.m.b.id;
      if (change === "payment") s.payments[0].status = "pending";
      if (change === "duplicate-event")
        s.analytics_events.push(
          s.analytics_events.find((x) => x.event_name === "payment_completed"),
        );
      if (change === "price") s.price_versions[0].active = true;
      if (change === "body") s.paid_reports[0].status = "ready";
      if (change === "fixture") s.diagnosis_answers[0].id = db.m.diagnosis;
      assert.throws(() => validatePaid(db.m, s, db.expected));
    } finally {
      await db.close();
    }
  });
test("transaction catches race and rolls back; forced failure after UPDATE rolls back", async () => {
  const db = await isolatedPaid();
  try {
    const sql = bodySql(db.m, db.baseline, db.expected, body);
    await db.pg.query("update payments set status='refunded'");
    await assert.rejects(db.pg.exec(sql));
    await db.pg.exec("rollback");
    assert.equal((await snapshot(db.read)).paid_reports[0].status, "queued");
  } finally {
    await db.close();
  }
  const db2 = await isolatedPaid();
  try {
    const sql = bodySql(db2.m, db2.baseline, db2.expected, body).replace(
      "END $continuation$;",
      "RAISE EXCEPTION 'injected failure'; END $continuation$;",
    );
    await assert.rejects(db2.pg.exec(sql));
    await db2.pg.exec("rollback");
    compareBaseline(await snapshot(db2.read), db2.baseline);
  } finally {
    await db2.close();
  }
});
test("continuation blocks Stripe, OpenAI, old DB, all purchase writes and unknown RPC before transport", async () => {
  const db = await isolatedPaid();
  try {
    const p = new ContinuationPolicy(db.m, db.expected);
    p.ready = true;
    for (const [url, method] of [
      ["https://api.stripe.com/v1/account", "GET"],
      ["https://api.openai.com/v1/models", "GET"],
      ["https://rnvrdrfdbapfafwjbygo.supabase.co/rest/v1/diagnoses", "GET"],
      [TARGET.supabase + "/rest/v1/payments", "POST"],
      [TARGET.supabase + "/rest/v1/price_versions", "PATCH"],
      [TARGET.supabase + "/rest/v1/paid_reports", "PATCH"],
      [TARGET.supabase + "/rest/v1/rpc/apply_stripe_event_v2", "POST"],
    ])
      assert.throws(() =>
        p.authorize({ url, method, headers: {}, body: "{}" }),
      );
    assert.throws(() =>
      supabaseTransport({ anon: "a", service: "b", stripe: "forbidden" }),
    );
    for (const path of [
      "/api/webhooks/stripe",
      "/api/diagnoses/" + db.m.diagnosis + "/checkout",
      "/api/diagnoses/" + db.m.diagnosis + "/report",
    ])
      assert.equal(safeRequest("POST", path), false);
  } finally {
    await db.close();
  }
});
test("SQL delimiter in baseline/body is refused before execution", async () => {
  const db = await isolatedPaid();
  try {
    assert.throws(() =>
      bodySql(db.m, db.baseline, db.expected, {
        ...body,
        contact_advice: "$continuation$",
      }),
    );
    compareBaseline(await snapshot(db.read), db.baseline);
  } finally {
    await db.close();
  }
});
test("non-test Stripe binding and wrong stored event type refused", async () => {
  const db = await isolatedPaid();
  try {
    assert.throws(() =>
      validatePaid(db.m, db.baseline, {
        ...db.expected,
        checkout: "cs_live_wrong",
      }),
    );
    const s = structuredClone(db.baseline);
    s.stripe_events[0].event_type = "unknown";
    assert.throws(() => validatePaid(db.m, s, db.expected));
  } finally {
    await db.close();
  }
});
