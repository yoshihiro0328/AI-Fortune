import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { evaluationDatabase } from "../scripts/phase6/ai-evaluation/isolated-db";
const m = vi.hoisted(() => ({ db: vi.fn(), parse: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  db: m.db,
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw Error("DB_FAILED");
    return r.data;
  },
}));
vi.mock("openai", () => ({
  default: class {
    responses = { parse: m.parse };
  },
}));
import { chatAnswer } from "@/lib/consultation/ai";
import { analyzeDiagnosis, generatePaid } from "@/lib/ai/pipeline";
import { initializeFlow, selectedQuestions } from "@/lib/questions/engine";
let local: Awaited<ReturnType<typeof evaluationDatabase>>;
const id = "40000000-0000-4000-8000-000000000001",
  user = "40000000-0000-4000-8000-000000000002";
function shape(s: Record<string, unknown>): unknown {
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (s.type === "object")
    return Object.fromEntries(
      Object.entries(
        s.properties as Record<string, Record<string, unknown>>,
      ).map(([k, v]) => [k, shape(v)]),
    );
  if (s.type === "array")
    return Array.from({ length: Number(s.minItems ?? 0) }, () =>
      shape(s.items as Record<string, unknown>),
    );
  if (s.type === "boolean") return false;
  if (s.type === "number" || s.type === "integer")
    return Number(s.minimum ?? 0);
  return "相手の都合を一度聞いてみてください。";
}
beforeAll(async () => {
  local = await evaluationDatabase();
  m.db.mockReturnValue(local.adapter);
  vi.stubEnv("OPENAI_API_KEY", "synthetic-key");
  vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
  vi.stubEnv("STRIPE_MODE", "sandbox");
  vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_fixture");
  await local.pg.query(
    "insert into payment_environment(id,mode,stripe_account_id) values(true,'sandbox','acct_fixture') on conflict(id) do update set stripe_account_id='acct_fixture'",
  );
  await local.pg.query("insert into auth.users(id) values($1)", [user]);
  m.parse.mockImplementation(async (p) => {
    const format = p.text.format,
      stage = format.name;
    const input = JSON.parse(p.input[1].content).untrusted_data;
    let result = shape(format.schema) as Record<string, unknown>;
    if (stage.includes("_rewrite_")) result = { edits: input.original };
    if (stage.includes("_review_"))
      result = {
        faithful: true,
        natural: true,
        safe: true,
        actionable: true,
        issues: [],
      };
    if (stage === "chat")
      result = {
        answer:
          "一度、都合のよい日を聞いてみてください。返事を待ってから次を考えましょう。",
        safety: false,
        facts: [],
      };
    return {
      output_parsed: result,
      usage: {
        input_tokens: 100,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
      },
    };
  });
}, 30000);
afterAll(async () => {
  await local?.close();
  vi.unstubAllEnvs();
});
it("actual consultation path stores synthetic call records in PGlite only", async () => {
  const r = await chatAnswer(
    { user, plan: "free", isTest: true },
    {
      memory: [],
      recent: [],
      message:
        "相談の目的：自分で書いた文を見てほしい\n\n今回は難しいです、と断りたい。",
      purpose: "review",
      today: "2026-10-26",
    },
  );
  expect(r.safety).toBe(false);
  const call = m.parse.mock.calls.find(
    ([p]) => p.text.format.name === "chat",
  )![0];
  expect(call.input[0].content).toContain("必要最小限の修正文");
  expect(call.input[0].content).toContain("【送信用文面】");
  expect(JSON.parse(call.input[1].content).untrusted_data.purpose).toBe(
    "review",
  );
  expect(
    m.parse.mock.calls.filter(([p]) => p.text.format.name === "chat"),
  ).toHaveLength(1);
  expect(
    (await local.pg.query("select success from consultation_ai_calls")).rows,
  ).toEqual([{ success: true }]);
});
it("actual diagnostic pipeline, editor, paid claim and finish use all migrations locally", async () => {
  await local.pg.query(
    "insert into diagnoses(id,diagnosis_type_id,anonymous_session_id,question_flow_version) select $1,id,'synthetic','v1' from diagnosis_types where slug='partner-mind'",
    [id],
  );
  await local.pg.query(
    "insert into diagnosis_answers(diagnosis_id,question_key,question_text,answer_text) select $1,question_key,question_text,'会う日を一度聞きたいです。' from diagnosis_questions where flow_version='v1' and is_active",
    [id],
  );
  expect(await analyzeDiagnosis(id)).toEqual({ status: "free_result_ready" });
  const calls = m.parse.mock.calls.length;
  expect(await analyzeDiagnosis(id)).toEqual({ status: "free_result_ready" });
  expect(m.parse.mock.calls.length).toBe(calls);
  await local.pg.query(
    "insert into payments(diagnosis_id,status,amount,currency,is_test) values($1,'paid',1980,'jpy',true)",
    [id],
  );
  await local.pg.query(
    "insert into paid_reports(diagnosis_id,payment_id,status) select diagnosis_id,id,'queued' from payments where diagnosis_id=$1",
    [id],
  );
  await generatePaid(id);
  expect(
    (
      await local.pg.query(
        "select status from paid_reports where diagnosis_id=$1",
        [id],
      )
    ).rows,
  ).toEqual([{ status: "ready" }]);
});

it("v2 persists selected questions and resumes the real pipeline without regenerating completed work", async () => {
  const dynamicId = "40000000-0000-4000-8000-000000000003";
  const type = (
    await local.pg.query<{ id: string }>(
      "select id from diagnosis_types where slug='partner-mind'",
    )
  ).rows[0].id;
  await local.pg.query(
    "insert into diagnoses(id,diagnosis_type_id,anonymous_session_id,question_flow_version) values($1,$2,'synthetic-v2','v2')",
    [dynamicId, type],
  );
  await initializeFlow(dynamicId, type);
  const selected = await selectedQuestions(dynamicId);
  expect(selected.length).toBeGreaterThanOrEqual(8);
  for (const q of selected)
    await local.pg.query(
      "insert into diagnosis_answers(diagnosis_id,question_key,question_text,answer_text) values($1,$2,$3,$4)",
      [
        dynamicId,
        q.question_key,
        q.question_text,
        "交際半年です。会う日を一度聞きたいです。",
      ],
    );
  expect(
    (await selectedQuestions(dynamicId)).map((q) => q.question_key),
  ).toEqual(selected.map((q) => q.question_key));
  expect(await analyzeDiagnosis(dynamicId)).toEqual({
    status: "free_result_ready",
  });
  const calls = m.parse.mock.calls.length;
  expect(await analyzeDiagnosis(dynamicId)).toEqual({
    status: "free_result_ready",
  });
  expect(m.parse.mock.calls.length).toBe(calls);
  expect(
    m.parse.mock.calls.some(([p]) => p.text.format.name === "dynamic_select"),
  ).toBe(true);
  expect(
    m.parse.mock.calls.some(([p]) => p.text.format.name === "dynamic_final"),
  ).toBe(true);
});
