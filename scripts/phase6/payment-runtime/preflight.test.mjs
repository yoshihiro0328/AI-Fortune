import test from "node:test";
import assert from "node:assert/strict";
import { isolatedPayment, frozenPaymentSql } from "./preflight-isolated.mjs";
import fs from "node:fs";
import { databasePreflight, startupQueries } from "./preflight.mjs";
import { checkedJson } from "./diagnostics.mjs";
import { TARGET } from "./policy.mjs";
const reader =
  (transport, records = []) =>
  (method, path, body, _maintenance, operation) =>
    checkedJson(
      transport,
      {
        method,
        url: TARGET.supabase + "/rest/v1/" + path,
        body: body ? JSON.stringify(body) : "",
      },
      {
        stage: "preflight",
        operation,
        record: (event, data) => records.push({ event, ...data }),
      },
    );

test("historical baseline stays frozen and refuses altered original SQL", () => {
  const baseline = frozenPaymentSql();
  assert.equal(baseline.length, 17);
  assert.equal(
    baseline.at(-1).file,
    "20261015081652_trial_auth_verification.sql",
  );
  assert.throws(
    () =>
      frozenPaymentSql(
        (path) =>
          fs.readFileSync(path, "utf8") +
          (path.endsWith(baseline[0].file) ? "\n-- changed" : ""),
      ),
    /POLICY_DENIED/,
  );
});

test("actual launcher queries: old id selector fails 42703, real schema corrected selector succeeds", async () => {
  const db = await isolatedPayment();
  try {
    assert.equal(db.migrations.length, 17);
    const records = [];
    const read = reader(db.transport, records);
    await assert.rejects(
      read(
        "GET",
        "billing_customers?select=id&limit=1",
        undefined,
        false,
        "billing_customers",
      ),
      /42703/,
    );
    assert.deepEqual(records.at(-1), {
      event: "operation_failed",
      stage: "preflight",
      operation: "billing_customers",
      httpStatus: 400,
      errorCode: "42703",
    });
    await databasePreflight(db.manifest, read);
    assert.deepEqual(
      startupQueries(db.manifest).map((x) => x.path),
      db.calls
        .slice(1)
        .map((call) => call.path.slice("/rest/v1/".length) + "?" + call.query),
    );
    assert.equal(db.calls.length, 11);
    assert(db.calls.every((x) => x.method === "GET"));
  } finally {
    await db.pg.close();
  }
});

for (const mutation of [
  "owner",
  "hash",
  "run",
  "answer-parent",
  "free-report-content",
  "extra-row",
  "billing-customer",
  "price",
])
  test(
    "retained fixture/schema rejects " + mutation + " without writes",
    async () => {
      const db = await isolatedPayment();
      try {
        if (mutation === "owner")
          await db.pg.query("update diagnoses set user_id=$1", [
            db.manifest.b.id,
          ]);
        if (mutation === "hash")
          await db.pg.exec("update diagnoses set anonymous_session_id='wrong'");
        if (mutation === "run")
          await db.pg.exec(
            "update diagnoses set classification_json=jsonb_set(classification_json,'{synthetic_run}','\"wrong\"')",
          );
        if (mutation === "answer-parent") {
          await db.pg.exec("delete from diagnosis_answers");
        }
        if (mutation === "free-report-content")
          await db.pg.exec("update free_reports set report_json='{}'");
        if (mutation === "extra-row")
          await db.pg.exec(
            "insert into diagnoses(anonymous_session_id,diagnosis_type_id) select 'other',diagnosis_type_id from diagnoses",
          );
        if (mutation === "billing-customer")
          await db.pg.query(
            "insert into billing_customers(user_id,stripe_customer_id) values($1,'cus_synthetic')",
            [db.manifest.a.id],
          );
        if (mutation === "price")
          await db.pg.exec("update price_versions set active=false");
        await assert.rejects(
          databasePreflight(db.manifest, reader(db.transport)),
        );
        assert(db.calls.every((x) => x.method === "GET"));
      } finally {
        await db.pg.close();
      }
    },
  );

for (const value of ["null", "{}", '{"length":0}', "not-json", ""])
  test(
    "errors and non-array responses never become empty data: " + value,
    async () => {
      const db = await isolatedPayment();
      try {
        await assert.rejects(
          databasePreflight(
            db.manifest,
            reader(async (r) =>
              r.url.includes("billing_customers?")
                ? { status: 200, text: value }
                : db.transport(r),
            ),
          ),
          /RESPONSE_SHAPE_INVALID/,
        );
      } finally {
        await db.pg.close();
      }
    },
  );

test("diagnostics keep status and allowlisted code, never provider payload or unknown code", async () => {
  const records = [];
  const secret = "DO_NOT_RECORD_key_JWT_cookie_email";
  for (const code of ["42501", secret])
    await assert.rejects(
      reader(
        async () => ({
          status: 403,
          text: JSON.stringify({
            code,
            message: secret,
            details: secret,
            hint: secret,
          }),
        }),
        records,
      )(
        "GET",
        "billing_customers?select=user_id",
        undefined,
        false,
        "billing_customers",
      ),
    );
  assert(!JSON.stringify(records).includes(secret));
  assert.deepEqual(
    records.map((x) => x.errorCode),
    ["42501", "HTTP_FAILED"],
  );
  assert(records.every((x) => x.httpStatus === 403));
});
