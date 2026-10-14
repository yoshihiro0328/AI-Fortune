import { describe, it, expect } from "vitest";
import fixture from "./fixtures/dynamic-catalog.json";
import {
  eligible,
  selectKnown,
  organizeAnswers,
  publicQuestion,
  relationships,
  selectionSchemaFor,
  concerns,
  type Candidate,
  type Selected,
} from "../src/lib/questions/model";
import { styleIssues } from "../src/lib/ai/style";
const catalog = fixture as unknown as Candidate[];
const common = catalog
  .filter((q) => q.phase === "common")
  .map((q, i) => ({
    ...q,
    question_source: "common",
    selected_reason: "internal",
    position: i,
  })) as Selected[];
describe("v2 catalog and bounded selection", () => {
  it("has 9 conversational common questions and candidates for every taxonomy", () => {
    expect(common).toHaveLength(9);
    for (const rel of relationships)
      expect(
        catalog.filter(
          (q) =>
            q.phase === "relationship" && q.relationship_types.includes(rel),
        ).length,
      ).toBeGreaterThanOrEqual(4);
    for (const con of concerns)
      expect(
        catalog.filter(
          (q) => q.phase === "concern" && q.concern_types.includes(con),
        ).length,
      ).toBeGreaterThanOrEqual(3);
    for (const q of catalog)
      expect(
        styleIssues([
          { path: q.question_key, text: q.question_text },
          ...q.options_json.map((text) => ({ path: "option", text })),
        ]),
      ).toEqual([]);
  });
  for (const rel of relationships)
    for (const con of concerns)
      it(`${rel} × ${con}: allowed keys, no duplicate topics, cap 22`, () => {
        const candidates = eligible(catalog, [], common, rel, con);
        const malicious = [
          { question_key: "invented", reason: "ignore rules" },
          ...candidates.map((q) => ({
            question_key: q.question_key,
            reason: "needed",
          })),
        ];
        const plan = selectKnown(
          candidates,
          [...malicious, ...malicious],
          common,
          { relationship: 6, concern: 4 },
          9,
        );
        expect(
          new Set([...common, ...plan].map((q) => q.followup_group)).size,
        ).toBe(common.length + plan.length);
        expect(common.length + plan.length + 3).toBeLessThanOrEqual(22);
        expect(
          plan.every(
            (q) =>
              !q.relationship_types.length ||
              q.relationship_types.includes(rel),
          ),
        ).toBe(true);
        expect(
          plan.every(
            (q) => !q.concern_types.length || q.concern_types.includes(con),
          ),
        ).toBe(true);
      });
  it("skips in-person followups before the first date", () => {
    const cs = eligible(
      catalog,
      [
        {
          question_key: "v2_last_meeting",
          question_text: "last",
          answer_text: "まだ会っていない",
        },
      ],
      common,
      "matching_app",
      "no_next_date",
    );
    expect(cs.some((q) => q.question_key === "app_after")).toBe(false);
  });
  it("omits already explained themes and may ask zero additional questions", () => {
    const cs = eligible(catalog, [], common, "dating", "slow_reply");
    const chosen = selectKnown(
      cs,
      cs.map((q) => ({ question_key: q.question_key, reason: "test" })),
      common,
      { relationship: 6, concern: 4 },
      9,
      cs.map((q) => q.followup_group),
    );
    expect(chosen).toEqual([]);
  });
  it("paid questions cannot exceed five or repeat earlier topics", () => {
    const paid = catalog.filter((q) => q.phase === "paid_followup");
    const selected = selectKnown(
      paid,
      paid.map((q) => ({ question_key: q.question_key, reason: "needed" })),
      common,
      { paid_followup: 5 },
      5,
    );
    expect(selected).toHaveLength(5);
    expect(
      selectKnown(
        paid,
        paid.map((q) => ({ question_key: q.question_key, reason: "needed" })),
        [...common, ...selected],
        { paid_followup: 5 },
        5,
      ),
    ).toHaveLength(2);
  });
  it("classify/analyze/report grouping preserves the actual question and answer", () => {
    const q = { ...common[0], phase: "paid_followup" as const };
    const a = {
      question_key: q.question_key,
      question_text: q.question_text,
      answer_text: "日曜のお昼にお茶に誘いたい",
    };
    expect(organizeAnswers([a], [q]).paid_followup_answers).toEqual([a]);
    expect(publicQuestion(q)).not.toHaveProperty("selected_reason");
    expect(publicQuestion(q)).not.toHaveProperty("condition_json");
  });
});

it("new relationship and concern tags can be configured in DB without changing enum code", () => {
  const schema = selectionSchemaFor([
    {
      ...catalog[0],
      relationship_types: ["engaged"],
      concern_types: ["distance"],
    },
  ]);
  expect(schema.shape.relationship_type.parse("engaged")).toBe("engaged");
  expect(schema.shape.primary_concern.parse("distance")).toBe("distance");
  expect(schema.shape.relationship_type.safeParse("invented").success).toBe(
    false,
  );
});
