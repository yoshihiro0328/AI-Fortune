import { z } from "zod";
import type { Question } from "../client";
export const relationships = [
  "dating",
  "crush",
  "friend",
  "ambiguous",
  "ex",
  "matching_app",
  "other",
] as const;
export const concerns = [
  "slow_reply",
  "decreased_contact",
  "cold_behavior",
  "no_next_date",
  "reconciliation",
  "jealousy",
  "breakup_risk",
  "commitment",
  "mixed_signals",
  "uncertainty",
  "other",
] as const;
import { phaseLabels, type Phase } from "./labels";
export { phaseLabels, type Phase } from "./labels";
export type Candidate = Question & {
  id: string;
  phase: Phase;
  relationship_types: string[];
  concern_types: string[];
  followup_group: string;
  priority: number;
  max_uses: number;
  condition_json: { key?: string; equals?: string[]; not_equals?: string[] };
};
export type Selected = Candidate & {
  question_source: string;
  selected_reason: string;
  position: number;
};
export type Answer = {
  question_key: string;
  question_text: string;
  answer_text: string;
};
export type Flow = {
  branched?: boolean;
  final_checked?: boolean;
  paid_checked?: boolean;
  paid_completed?: boolean;
  relationship_type?: string;
  primary_concern?: string;
  information_gaps?: string[];
  contradictions?: string[];
  paid_followup_needed?: boolean;
};
const choice = z.object({
  question_key: z.string(),
  reason: z.string().max(500),
});
export const selectionSchema = z.object({
  relationship_type: z.enum(relationships),
  primary_concern: z.enum(concerns),
  information_gaps: z.array(z.string()).max(6),
  contradictions: z.array(z.string()).max(4),
  covered_groups: z.array(z.string()).max(40),
  questions: z.array(choice).max(10),
  risk_detected: z.boolean(),
});
export const finalSelectionSchema = z.object({
  information_gaps: z.array(z.string()).max(6),
  contradictions: z.array(z.string()).max(4),
  questions: z.array(choice).max(3),
  generated: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z_]{1,35}$/),
        question: z.string().min(8).max(180),
        reason: z.string().min(1).max(500),
        group: z.string().min(1).max(60),
      }),
    )
    .max(3),
  risk_detected: z.boolean(),
});
export const paidSelectionSchema = z.object({
  paid_followup_needed: z.boolean(),
  questions: z.array(choice).max(5),
  risk_detected: z.boolean(),
});
export function eligible(
  catalog: Candidate[],
  answers: Answer[],
  selected: Selected[],
  relationship?: string,
  concern?: string,
) {
  const groups = new Set(selected.map((q) => q.followup_group));
  const values = Object.fromEntries(
    answers.map((a) => [a.question_key, a.answer_text]),
  );
  return catalog
    .filter((q) => {
      const c = q.condition_json;
      return (
        q.max_uses > 0 &&
        !groups.has(q.followup_group) &&
        (!q.relationship_types.length ||
          !relationship ||
          q.relationship_types.includes(relationship)) &&
        (!q.concern_types.length ||
          !concern ||
          q.concern_types.includes(concern)) &&
        (!c.key ||
          ((!c.equals || c.equals.includes(values[c.key])) &&
            (!c.not_equals || !c.not_equals.includes(values[c.key]))))
      );
    })
    .sort((a, b) => b.priority - a.priority);
}
// The server accepts only known, eligible keys. One semantic group can be asked once.
export function selectKnown(
  candidates: Candidate[],
  choices: { question_key: string; reason: string }[],
  selected: Selected[],
  limits: Partial<Record<Phase, number>>,
  totalLimit: number,
  covered: string[] = [],
): Selected[] {
  const groups = new Set([
    ...selected.map((q) => q.followup_group),
    ...covered,
  ]);
  const result: Selected[] = [];
  for (const choice of choices) {
    const q = candidates.find((q) => q.question_key === choice.question_key);
    if (
      !q ||
      groups.has(q.followup_group) ||
      result.length >= totalLimit ||
      result.filter((s) => s.phase === q.phase).length >= (limits[q.phase] ?? 0)
    )
      continue;
    groups.add(q.followup_group);
    result.push({
      ...q,
      question_source: q.phase === "paid_followup" ? q.phase : "ai_selected",
      selected_reason: choice.reason,
      position: selected.length + result.length,
    });
  }
  return result;
}
export function organizeAnswers(answers: Answer[], selected: Selected[]) {
  return Object.fromEntries(
    (Object.keys(phaseLabels) as Phase[]).map((phase) => [
      phase + "_answers",
      answers.filter((a) =>
        selected.some(
          (q) => q.question_key === a.question_key && q.phase === phase,
        ),
      ),
    ]),
  );
}
export function publicQuestion(q: Selected): Question {
  return {
    question_key: q.question_key,
    question_text: q.question_text,
    question_type: q.question_type,
    options_json: q.options_json,
    placeholder: q.placeholder,
    required: q.required,
    phase: q.phase,
  };
}
