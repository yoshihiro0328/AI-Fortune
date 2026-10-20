import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedSubscription } from "./isolated.mjs";
import { observePreflight, preflight } from "./journal.mjs";
import { TARGET } from "./policy.mjs";
test("actual preflight queries on 17 migrations: retained schema, missing/different rows stop", async () => {
  const db = await isolatedSubscription(),
    queries = [];
  const read = async (p) => {
    queries.push(p);
    const r = await db.transport({
      url: TARGET.supabase + "/rest/v1/" + p,
      method: "GET",
      headers: {
        apikey: "local-service",
        authorization: "Bearer local-service",
      },
    });
    assert.equal(r.status, 200);
    return JSON.parse(r.text);
  };
  try {
    const expected = await observePreflight(db.m, read);
    assert.deepEqual(await preflight(db.m, read, expected), expected);
    assert(queries.some((q) => q.startsWith("paid_reports?select=*&id=eq.")));
    assert(
      !queries.some(
        (q) => q.startsWith("paid_reports?") && q.includes("user_id"),
      ),
    );
    await assert.rejects(preflight(db.m, read, undefined), /BASELINE_MISMATCH/);
    await db.pg.query(
      "update profiles set display_name='changed' where user_id=$1",
      [db.m.d.id],
    );
    await assert.rejects(preflight(db.m, read, expected), /BASELINE_MISMATCH/);
    await db.pg.query("delete from diagnosis_answers where id=$1", [
      db.m.retained.diagnosis_answers,
    ]);
    await assert.rejects(
      preflight(db.m, read, expected),
      /RETAINED_ROW_MISSING/,
    );
  } finally {
    await db.close();
  }
});
