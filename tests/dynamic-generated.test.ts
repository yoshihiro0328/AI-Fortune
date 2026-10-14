import { it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  run: vi.fn(),
}));
vi.mock("../src/lib/ai/run", () => ({ runAI: m.run }));
vi.mock("../src/lib/ai/editor", () => ({
  editForReader: (
    _id: string,
    _scope: string,
    schema: { parse: (v: unknown) => unknown },
    v: unknown,
  ) => schema.parse(v),
}));
vi.mock("../src/lib/supabase/admin", () => ({
  checked: (r: { data: unknown }) => r.data,
  db: () => ({
    rpc: m.rpc,
    from: (table: string) => {
      const rows =
        table === "diagnosis_selected_questions"
          ? [
              {
                snapshot: {
                  id: "id",
                  question_key: "common",
                  phase: "common",
                  followup_group: "common",
                },
              },
            ]
          : table === "diagnosis_answers"
            ? [
                {
                  question_key: "common",
                  question_text: "いつ？",
                  answer_text: "話が食い違う",
                },
              ]
            : [];
      const q = {
        select: () => q,
        eq: () => q,
        order: () => Promise.resolve({ data: rows, error: null }),
        single: () =>
          Promise.resolve({
            data: {
              diagnosis_type_id: "type",
              question_flow_json: { branched: true },
            },
            error: null,
          }),
        then: (resolve: (x: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return q;
    },
  }),
}));
import { advanceFlow } from "../src/lib/questions/engine";
it("generated keys pass the legacy editorial schema; filtered questions retain the matching group/reason", async () => {
  m.run.mockImplementation(async (_id: string, stage: string) =>
    stage === "dynamic_final"
      ? {
          information_gaps: ["時期"],
          contradictions: ["食い違い"],
          questions: [],
          risk_detected: false,
          generated: [
            {
              key: "first",
              question: "いつのことか教えてください。",
              reason: "first reason",
              group: "time_a",
            },
            {
              key: "second",
              question: "最後に会ったのはいつ頃ですか？",
              reason: "second reason",
              group: "time_b",
            },
          ],
        }
      : { approved_keys: ["dynamic_follow_b"] },
  );
  expect(await advanceFlow("id", {})).toBe(false);
  const args = m.rpc.mock.calls[0][1];
  expect(args.p_questions).toHaveLength(1);
  expect(args.p_questions[0]).toMatchObject({
    question_key: "dynamic_follow_b",
    followup_group: "time_b",
    selected_reason: "second reason",
    phase: "ai_followup",
    question_source: "ai_generated",
  });
  expect(args.p_flow.final_checked).toBe(true);
});
