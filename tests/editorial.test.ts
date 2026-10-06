import { it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { textLeaves, mergeText, styleIssues } from "../src/lib/ai/style";
const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/lib/ai/run", () => ({ runAI: run }));
vi.mock("../src/lib/supabase/admin", () => ({
  db: () => ({
    from: () => ({
      update: () => {
        const q = { eq: () => q, in: async () => ({ error: null }) };
        return q;
      },
    }),
  }),
  checked: (r: { error: unknown }) => {
    if (r.error) throw r.error;
  },
}));
import { editForReader } from "../src/lib/ai/editor";
beforeEach(() => run.mockReset());
it("rewrites text while retaining scores, booleans and all array items", () => {
  const original = {
    summary: "2日後に対話する。",
    scores: { x: 42 },
    ok: true,
    list: ["会う"],
  };
  const edits = textLeaves(original).map((x) => ({
    ...x,
    text: x.text.replace("対話する", "話す"),
  }));
  expect(mergeText(original, edits)).toEqual({
    ...original,
    summary: "2日後に話す。",
  });
  expect(() => mergeText(original, edits.slice(1))).toThrow();
  expect(() => mergeText(original, [...edits, edits[0]])).toThrow();
  expect(() =>
    mergeText(
      original,
      edits.map((x) => ({ ...x, text: x.text.replace("2", "3") })),
    ),
  ).toThrow("numbers");
});
it("followup identifiers, types, reasons and safety booleans cannot be edited", () => {
  const original = {
    needs_follow_up: true,
    questions: [
      {
        key: "reply",
        type: "textarea",
        question: "面会はいつ？",
        reason: "内部理由",
      },
    ],
  };
  expect(textLeaves(original, "followup")).toEqual([
    { path: "questions.0.question", text: "面会はいつ？" },
  ]);
  expect(
    mergeText(
      original,
      [{ path: "questions.0.question", text: "いつ会いましたか？" }],
      "followup",
    ),
  ).toEqual({
    ...original,
    questions: [{ ...original.questions[0], question: "いつ会いましたか？" }],
  });
});
it("rejects bureaucratic language, long sentences and repeated hedges", () => {
  expect(
    styleIssues([
      {
        path: "s",
        text: "次回面会時に相手との接触や対話を行う。可能性があります。可能性があります。",
      },
    ]),
  ).toHaveLength(2);
  expect(styleIssues([{ path: "s", text: "あ".repeat(111) }])).toHaveLength(1);
});
it("a review identifying factual drift never releases the draft", async () => {
  run
    .mockResolvedValueOnce({
      edits: [{ path: "summary", text: "会って話してみてください。" }],
    })
    .mockResolvedValueOnce({
      faithful: false,
      natural: true,
      safe: true,
      actionable: true,
      issues: ["拒否条件を削除"],
    })
    .mockResolvedValueOnce({
      edits: [{ path: "summary", text: "対話してください。" }],
    });
  await expect(
    editForReader("id", "free_report", z.object({ summary: z.string() }), {
      summary: "断られていなければ話してみてください。",
    }),
  ).rejects.toThrow("withheld");
});
it("only accepted editorial review releases a candidate", async () => {
  run
    .mockResolvedValueOnce({
      edits: [{ path: "summary", text: "会って話してみてください。" }],
    })
    .mockResolvedValueOnce({
      faithful: true,
      natural: true,
      safe: true,
      actionable: true,
      issues: [],
    });
  expect(
    await editForReader(
      "id",
      "free_report",
      z.object({ summary: z.string() }),
      { summary: "面会して対話してください。" },
    ),
  ).toEqual({ summary: "会って話してみてください。" });
});
