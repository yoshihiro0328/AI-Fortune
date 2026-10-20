import { isDeepStrictEqual } from "node:util";
import { TARGET, insist, uuid } from "./policy.mjs";
import { freeExample } from "./fixture-sql.mjs";

// These are the exact REST queries used by the launcher, not a test-only copy.
export function startupQueries(m) {
  insist(
    [m.run, m.diagnosis, m.answer, m.freeReport, m.type].every(uuid),
    "FIXTURE_MANIFEST_INVALID",
  );
  insist(
    new Set([m.diagnosis, m.answer, m.freeReport]).size === 3 &&
      /^[a-f0-9]{64}$/.test(m.anonymousHash),
    "FIXTURE_MANIFEST_INVALID",
  );
  return [
    ["environment", "payment_environment?select=mode,stripe_account_id"],
    ["prices", "price_versions?select=*"],
    [
      "diagnosis",
      "diagnoses?select=id,user_id,anonymous_session_id,diagnosis_type_id,status,question_flow_version,classification_json&limit=2",
    ],
    [
      "answer",
      "diagnosis_answers?select=id,diagnosis_id,question_key,question_text,answer_text&limit=2",
    ],
    [
      "free_report",
      "free_reports?select=id,diagnosis_id,report_json,model,prompt_version&limit=2",
    ],
    ["payments", "payments?select=id&limit=1"],
    ["subscriptions", "subscriptions?select=id&limit=1"],
    ["billing_customers", "billing_customers?select=user_id&limit=1"],
    ["ai_calls", "ai_calls?select=id&limit=1"],
    ["paid_reports", "paid_reports?select=id&limit=1"],
  ].map(([operation, path]) => ({ operation, path }));
}

export async function databasePreflight(m, read, checkpoint = () => {}) {
  for (const { operation, path } of startupQueries(m)) {
    checkpoint(operation);
    const rows = await read("GET", path, undefined, false, operation);
    insist(Array.isArray(rows), "RESPONSE_SHAPE_INVALID");
    if (operation === "environment") {
      insist(
        rows.length === 1 &&
          rows[0].mode === "sandbox" &&
          rows[0].stripe_account_id === TARGET.account,
        "ENVIRONMENT_MISMATCH",
      );
    } else if (operation === "prices") {
      const p = rows.find((x) => x.id === TARGET.version);
      insist(
        rows.length === 6 &&
          new Set(rows.map((x) => x.id)).size === 6 &&
          rows.every((x) => typeof x.active === "boolean") &&
          rows.filter((x) => x.active).length === 1 &&
          p?.active === true &&
          p.is_test === true &&
          p.kind === "report" &&
          p.amount === 980 &&
          p.currency === "jpy" &&
          p.stripe_price_id === TARGET.price &&
          p.stripe_product_id === TARGET.product,
        "PRICES_MISMATCH",
      );
    } else if (operation === "diagnosis") {
      insist(
        rows.length === 1 &&
          isDeepStrictEqual(rows[0], {
            id: m.diagnosis,
            user_id: m.a.id,
            anonymous_session_id: m.anonymousHash,
            diagnosis_type_id: m.type,
            status: "free_result_ready",
            question_flow_version: "v1",
            classification_json: {
              relationship_type: "synthetic",
              primary_concern: "payment-test",
              user_goal: "permission-test",
              emotional_intensity: "low",
              risk_detected: false,
              confidence: 1,
              risk_type: "none",
              severity: "none",
              synthetic_run: m.run,
            },
          }),
        "RETAINED_FIXTURE_MISMATCH",
      );
    } else if (operation === "answer") {
      insist(
        rows.length === 1 &&
          isDeepStrictEqual(rows[0], {
            id: m.answer,
            diagnosis_id: m.diagnosis,
            question_key: "payment_synthetic",
            question_text: "【合成】表示確認用の質問",
            answer_text: "【合成】架空の人物甲と乙の表示確認です。",
          }),
        "RETAINED_FIXTURE_MISMATCH",
      );
    } else if (operation === "free_report") {
      insist(
        rows.length === 1 &&
          isDeepStrictEqual(rows[0], {
            id: m.freeReport,
            diagnosis_id: m.diagnosis,
            report_json: freeExample,
            model: "synthetic-no-ai",
            prompt_version: "payment-" + m.run,
          }),
        "RETAINED_FIXTURE_MISMATCH",
      );
    } else insist(rows.length === 0, "PREEXISTING_PAYMENT_DATA");
  }
}
