import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  TARGET,
  insist,
  uuid,
  validateManifest,
} from "../payment-runtime/policy.mjs";
export const tables = [
  "payment_environment",
  "price_versions",
  "profiles",
  "diagnoses",
  "diagnosis_answers",
  "free_reports",
  "payments",
  "paid_reports",
  "stripe_events",
  "analytics_events",
  "ai_calls",
  "subscriptions",
  "billing_customers",
  "operation_locks",
];
export const canonical = (rows) =>
  JSON.stringify(
    rows
      .map((x) => Object.fromEntries(Object.entries(x).sort()))
      .sort((a, b) =>
        String(a.id ?? a.user_id).localeCompare(String(b.id ?? b.user_id)),
      ),
  );
export const eventCount = (rows, name, id) =>
  rows.filter(
    (x) =>
      x.event_name === name &&
      x.metadata?.diagnosis_id === id &&
      x.is_test === true,
  ).length;
export function reportBody(repo) {
  return JSON.parse(
    fs.readFileSync(
      repo + "/scripts/phase6/payment-report-fixture.json",
      "utf8",
    ),
  );
}
export async function snapshot(read) {
  const result = {};
  for (const t of tables) {
    result[t] = await read(t + "?select=*", t);
    insist(Array.isArray(result[t]), "RESPONSE_SHAPE_INVALID");
  }
  return result;
}
export function validatePaid(m, s, expected, body = null) {
  validateManifest(m);
  insist(
    /^cs_test_[A-Za-z0-9_]+$/.test(expected.checkout) &&
      /^pi_[A-Za-z0-9_]+$/.test(expected.intent) &&
      /^evt_[A-Za-z0-9_]+$/.test(expected.event),
    "TEST_BINDING_REQUIRED",
  );
  insist(
    [m.answer, m.freeReport, m.type, expected.payment, expected.report].every(
      uuid,
    ),
  );
  insist(
    s.payment_environment.length === 1 &&
      s.payment_environment[0].mode === "sandbox" &&
      s.payment_environment[0].stripe_account_id === TARGET.account,
    "ENVIRONMENT_MISMATCH",
  );
  insist(
    s.price_versions.length === 6 &&
      s.price_versions.every((x) => x.active === false),
    "PRICES_MISMATCH",
  );
  insist(
    s.profiles.length === 2 &&
      [m.a.id, m.b.id].every((id) => s.profiles.some((x) => x.user_id === id)),
  );
  insist(
    s.diagnoses.length === 1 &&
      s.diagnosis_answers.length === 1 &&
      s.free_reports.length === 1,
    "RETAINED_FIXTURE_MISMATCH",
  );
  const d = s.diagnoses[0],
    a = s.diagnosis_answers[0],
    f = s.free_reports[0];
  insist(
    d.id === m.diagnosis &&
      d.user_id === m.a.id &&
      d.anonymous_session_id === m.anonymousHash &&
      d.diagnosis_type_id === m.type &&
      d.classification_json?.synthetic_run === m.run &&
      d.status === "paid",
    "RETAINED_FIXTURE_MISMATCH",
  );
  insist(
    a.id === m.answer &&
      f.id === m.freeReport &&
      a.diagnosis_id === d.id &&
      f.diagnosis_id === d.id,
    "RETAINED_FIXTURE_MISMATCH",
  );
  insist(s.payments.length === 1 && s.paid_reports.length === 1);
  const p = s.payments[0],
    r = s.paid_reports[0];
  insist(
    p.id === expected.payment &&
      p.diagnosis_id === d.id &&
      p.user_id === m.a.id &&
      p.status === "paid" &&
      p.amount === 980 &&
      p.currency === "jpy" &&
      p.is_test === true &&
      p.price_version === TARGET.version &&
      p.stripe_checkout_session_id === expected.checkout &&
      p.stripe_payment_intent_id === expected.intent,
    "PAYMENT_MISMATCH",
  );
  insist(
    r.id === expected.report &&
      r.payment_id === p.id &&
      r.diagnosis_id === d.id &&
      r.attempts === 0 &&
      r.lease_token === null &&
      r.lease_until === null,
  );
  if (body)
    insist(
      r.status === "ready" &&
        isDeepStrictEqual(r.report_json, body) &&
        r.model === "synthetic-no-ai" &&
        r.prompt_version === "payment-integration-example",
    );
  else
    insist(
      r.status === "queued" && r.report_json === null,
      "REPORT_NOT_QUEUED",
    );
  insist(
    s.stripe_events.length === 1 &&
      s.stripe_events[0].stripe_event_id === expected.event &&
      s.stripe_events[0].payment_id === p.id &&
      s.stripe_events[0].event_type === "checkout.session.completed" &&
      s.stripe_events[0].is_test === true,
  );
  insist(
    eventCount(s.analytics_events, "payment_completed", d.id) === 1 &&
      eventCount(s.analytics_events, "checkout_started", d.id) === 1,
    "ANALYTICS_MISMATCH",
  );
  for (const t of [
    "ai_calls",
    "subscriptions",
    "billing_customers",
    "operation_locks",
  ])
    insist(s[t].length === 0, "UNEXPECTED_RELATED_ROWS");
}
export function compareBaseline(s, b) {
  for (const t of tables)
    insist(canonical(s[t]) === canonical(b[t]), "BASELINE_MISMATCH");
}
export function verifyAfter(before, after, body) {
  for (const t of tables) {
    if (t !== "paid_reports")
      insist(
        canonical(before[t]) === canonical(after[t]),
        "UNEXPECTED_DATA_CHANGE",
      );
    else {
      const a = { ...after[t][0] },
        b = { ...before[t][0] };
      for (const k of [
        "report_json",
        "status",
        "model",
        "prompt_version",
        "updated_at",
      ]) {
        delete a[k];
        delete b[k];
      }
      insist(isDeepStrictEqual(a, b), "UNEXPECTED_REPORT_CHANGE");
      insist(isDeepStrictEqual(after[t][0].report_json, body));
    }
  }
}
const lit = (x) => "'" + String(x).replaceAll("'", "''") + "'";
// The exact returned SQL is executed by both PostgreSQL tests and the hosted psql adapter.
// No migration/RPC is installed. Only the already-created report UUID can be updated.
export function bodySql(m, b, e, body) {
  validatePaid(m, b, e);
  insist(
    !JSON.stringify([b, body]).includes("$continuation$"),
    "SQL_DELIMITER_IN_DATA",
  );
  const guards = tables
    .map(
      (t) =>
        `IF (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb) FROM public.${t} x) IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb) FROM jsonb_populate_recordset(NULL::public.${t},${lit(JSON.stringify(b[t]))}::jsonb) x) THEN RAISE EXCEPTION 'CONTINUATION_STATE_CHANGED'; END IF;`,
    )
    .join("\n");
  return `BEGIN;\nSET LOCAL standard_conforming_strings=on; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='60s';
LOCK TABLE ${tables.map((t) => "public." + t).join(",")},trial_private.settings IN SHARE ROW EXCLUSIVE MODE;
DO $continuation$ DECLARE n integer; BEGIN
IF current_database()<>'postgres' OR current_user<>'postgres' THEN RAISE EXCEPTION 'CONTINUATION_DB_ROLE'; END IF;
IF NOT EXISTS(SELECT 1 FROM trial_private.settings WHERE id AND NOT enabled) OR EXISTS(SELECT 1 FROM trial_private.settings WHERE enabled) THEN RAISE EXCEPTION 'CONTINUATION_TRIAL_ENABLED'; END IF;
${guards}
UPDATE public.paid_reports SET report_json=${lit(JSON.stringify(body))}::jsonb,status='ready',model='synthetic-no-ai',prompt_version='payment-integration-example',updated_at=now() WHERE id=${lit(e.report)}::uuid AND payment_id=${lit(e.payment)}::uuid AND diagnosis_id=${lit(m.diagnosis)}::uuid AND status='queued' AND attempts=0 AND report_json IS NULL;
GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'CONTINUATION_UPDATE_COUNT'; END IF;
END $continuation$;\nCOMMIT;\n`;
}
