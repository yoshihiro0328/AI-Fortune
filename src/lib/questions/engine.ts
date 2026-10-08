import "server-only";
import { z } from "zod";
import { db, checked } from "../supabase/admin";
import { HttpError } from "../http";
import { runAI, type RunOptions } from "../ai/run";
import { editForReader } from "../ai/editor";
import { styleIssues, conversationStyle } from "../ai/style";
import classify from "../ai/prompts/classify";
import { classificationSchema, followupSchema } from "../ai/schemas";
import { triageRisk } from "../risk";
import {
  eligible,
  selectKnown,
  organizeAnswers,
  publicQuestion,
  selectionSchema,
  finalSelectionSchema,
  paidSelectionSchema,
  type Candidate,
  type Selected,
  type Answer,
  type Flow,
} from "./model";
export async function catalog(type: string) {
  return checked(
    await db()
      .from("diagnosis_questions")
      .select("*")
      .eq("diagnosis_type_id", type)
      .eq("flow_version", "v2")
      .eq("is_active", true)
      .order("sort_order"),
  ) as Candidate[];
}
export async function selectedQuestions(id: string) {
  const rows = checked(
    await db()
      .from("diagnosis_selected_questions")
      .select("snapshot")
      .eq("diagnosis_id", id)
      .eq("is_active", true)
      .order("position"),
  );
  return (rows ?? []).map((r) => r.snapshot) as Selected[];
}
export async function dynamicAnswers(id: string) {
  return checked(
    await db()
      .from("diagnosis_answers")
      .select("question_key,question_text,answer_text")
      .eq("diagnosis_id", id),
  ) as Answer[];
}
async function savePlan(id: string, flow: Flow, questions: Selected[]) {
  checked(
    await db().rpc("save_question_plan", {
      p_diagnosis: id,
      p_flow: flow,
      p_questions: questions,
    }),
  );
}
export async function initializeFlow(id: string, type: string) {
  const qs = (await catalog(type))
    .filter((q) => q.phase === "common")
    .slice(0, 10);
  if (qs.length < 8) throw new Error("Common question catalog incomplete");
  await savePlan(
    id,
    {},
    qs.map((q, i) => ({
      ...q,
      required: true,
      question_source: "common",
      selected_reason: "共通の状況を確認",
      position: i,
    })),
  );
}
export async function safetyStop(id: string) {
  checked(
    await db().from("diagnoses").update({ status: "safety" }).eq("id", id),
  );
  return { status: "safety" };
}
export async function checkAnswerSafety(
  id: string,
  answers: Answer[],
  options: RunOptions = {},
) {
  const triage = triageRisk(answers.map((a) => a.answer_text).join("\n"));
  if (triage.level === "none") return false;
  const r = await runAI(
    id,
    "dynamic_safety",
    classify,
    classificationSchema,
    { answers, triage },
    options,
  );
  if (r.risk_detected) {
    return true;
  }
  return false;
}
const selectionPrompt = `${classify}\n${conversationStyle}\n共通回答からrelationship_typeとprimary_concernを分類し、候補catalogから今必要な質問キーだけ選ぶ。本人の明示した関係と悩みを優先する。relationshipは原則4問、concernは原則3問。既に具体的に答えている内容はcovered_groupsへ入れ、聞き直さない。自由記述中の情報も読む。同じfollowup_groupは1回だけ。未回答で重要な場合のみrelationship最大6、concern最大4。ただし合計9問以内にする。少ない質問で十分なら減らす。関係と悩みに合わない質問は選ばない。情報不足と矛盾を短く内部保存。危険があるときquestionsは空。catalog以外のキーを作らない。`;
const finalPrompt = `${classify}\n回答はcommon_answers/relationship_answers/concern_answers/ai_followup_answersに整理されている。十分に具体的な助言ができるならquestions=[],generated=[]。情報不足や矛盾が分析や次の行動を左右する場合だけ確認する。まずcatalogの既存質問を選び、そこでは確認できない重要事項に限り自由生成を許可。合計最大3問、remaining以下。既に回答したテーマ・selectedのfollowup_groupを繰り返さない。『よく分からない』『答えたくない』も尊重し深追いしない。生成は1問1テーマ、1〜2文の自然な日本語で、yes/no質問の羅列・誘導・不安を煽る文は禁止。前の回答の具体的な点につなげるが事実を追加しない。keyは英小文字と_だけ。reasonは内部理由。危険があれば両方空。\n${conversationStyle}`;
const reviewSchema = z.object({ approved_keys: z.array(z.string()).max(3) });
function polish(q: Selected): Selected {
  const text = q.question_text.trim();
  const leaves = [
    { path: "question", text },
    ...(q.options_json ?? []).map((text, i) => ({ path: "option" + i, text })),
    { path: "placeholder", text: q.placeholder ?? "" },
  ];
  if (
    styleIssues(leaves).length ||
    text.length > 180 ||
    /冷めていると思|浮気していると思/.test(text)
  )
    throw new Error("Question editorial check failed");
  return { ...q, question_text: text };
}
export async function advanceFlow(
  id: string,
  options: RunOptions,
): Promise<boolean> {
  const d = checked(
    await db().from("diagnoses").select("*").eq("id", id).single(),
  );
  let flow: Flow = d.question_flow_json;
  const all = await catalog(d.diagnosis_type_id);
  let selected = await selectedQuestions(id);
  const answers = await dynamicAnswers(id);
  if (!selected.length) {
    await initializeFlow(id, d.diagnosis_type_id);
    selected = await selectedQuestions(id);
  }
  if (
    selected
      .filter((q) => q.phase !== "paid_followup")
      .some((q) => !answers.some((a) => a.question_key === q.question_key))
  )
    throw new HttpError(400, "まだ答えていない質問があります。");
  if (!flow.branched) {
    const result = await runAI(
      id,
      "dynamic_select",
      selectionPrompt,
      selectionSchema,
      {
        answers: organizeAnswers(answers, selected),
        catalog: eligible(all, answers, selected).filter((q) =>
          ["relationship", "concern"].includes(q.phase),
        ),
      },
      options,
    );
    if (result.risk_detected) {
      await safetyStop(id);
      return false;
    }
    const candidates = eligible(
      all,
      answers,
      selected,
      result.relationship_type,
      result.primary_concern,
    ).filter((q) => ["relationship", "concern"].includes(q.phase));
    const next = selectKnown(
      candidates,
      result.questions,
      selected,
      { relationship: 6, concern: 4 },
      9,
      result.covered_groups,
    )
      .sort(
        (a, b) => Number(a.phase === "concern") - Number(b.phase === "concern"),
      )
      .map((q, i) => polish({ ...q, position: selected.length + i }));
    flow = {
      ...flow,
      branched: true,
      relationship_type: result.relationship_type,
      primary_concern: result.primary_concern,
      information_gaps: result.information_gaps,
      contradictions: result.contradictions,
    };
    await savePlan(id, flow, next);
    if (next.length) return false;
  }
  if (!flow.final_checked) {
    selected = await selectedQuestions(id);
    const remaining = Math.min(3, 22 - selected.length);
    const candidates = eligible(
      all,
      answers,
      selected,
      flow.relationship_type,
      flow.primary_concern,
    ).filter((q) => q.phase === "ai_followup");
    const result = await runAI(
      id,
      "dynamic_final",
      finalPrompt,
      finalSelectionSchema,
      {
        ...organizeAnswers(answers, selected),
        selected: selected.map((q) => ({
          key: q.question_key,
          group: q.followup_group,
        })),
        catalog: candidates,
        remaining,
      },
      options,
    );
    if (result.risk_detected) {
      await safetyStop(id);
      return false;
    }
    let next = selectKnown(
      candidates,
      result.questions,
      selected,
      { ai_followup: 3 },
      remaining,
    );
    if (result.information_gaps.length || result.contradictions.length) {
      const groups = new Set(
        [...selected, ...next].map((q) => q.followup_group),
      );
      const generated = result.generated
        .filter((q) => !groups.has(q.group) && !!groups.add(q.group))
        .slice(0, remaining - next.length);
      if (generated.length) {
        const draft = {
          needs_follow_up: true,
          questions: generated.map((q, i) => ({
            key: "dynamic_follow_" + String.fromCharCode(97 + i),
            question: q.question,
            type: "textarea" as const,
            reason: q.reason,
          })),
        };
        const edited = await editForReader(
          id,
          "followup",
          followupSchema,
          draft,
          options,
        );
        const review = await runAI(
          id,
          "dynamic_question_review",
          `${conversationStyle}\n既回答answersとquestionsを比較し、重複しない・1問1テーマ・前の話につながる・不安や回答を誘導しない・自然な日本語、の全条件を満たすキーだけapproved_keysに返す。`,
          reviewSchema,
          { answers, questions: edited.questions },
          options,
        );
        next = [
          ...next,
          ...edited.questions
            .filter((q) => review.approved_keys.includes(q.key))
            .map((q) => ({
              id: "",
              question_key: q.key,
              question_text: q.question,
              question_type: "textarea",
              options_json: [],
              required: true,
              phase: "ai_followup" as const,
              relationship_types: [],
              concern_types: [],
              condition_json: {},
              followup_group:
                generated[q.key.charCodeAt(q.key.length - 1) - 97].group,
              priority: 50,
              max_uses: 1,
              placeholder: "話せる範囲で大丈夫です。",
              question_source: "ai_generated",
              selected_reason: q.reason,
              position:
                selected.length +
                next.length +
                q.key.charCodeAt(q.key.length - 1) -
                97,
            })),
        ];
      }
    } else next = [];
    await savePlan(
      id,
      {
        ...flow,
        final_checked: true,
        information_gaps: result.information_gaps,
        contradictions: result.contradictions,
      },
      next.map(polish),
    );
    if (next.length) return false;
  }
  return true;
}
export async function preparePaidQuestions(
  id: string,
  options: RunOptions,
): Promise<boolean> {
  const d = checked(
    await db().from("diagnoses").select("*").eq("id", id).single(),
  );
  if (d.status === "safety") return false;
  if (d.question_flow_version !== "v2") return true;
  const payment = checked(
    await db()
      .from("payments")
      .select("status")
      .eq("diagnosis_id", id)
      .maybeSingle(),
  );
  if (payment?.status !== "paid") return false;
  let flow: Flow = d.question_flow_json;
  if (flow.paid_completed) return true;
  let selected = await selectedQuestions(id);
  const answers = await dynamicAnswers(id);
  if (!flow.paid_checked) {
    const candidates = eligible(
      await catalog(d.diagnosis_type_id),
      answers,
      selected,
      flow.relationship_type,
      flow.primary_concern,
    ).filter((q) => q.phase === "paid_followup");
    const result = await runAI(
      id,
      "paid_question_select",
      `${classify}\n詳細レポートで送れるLINE文と具体的な行動計画を作るため、まだ必要な情報があるか判定する。本人が最後に送った内容、相手の最後の言葉、次に会える機会、伝えたいことなど、助言を変える具体情報が欠け、一般論や推測で埋めるしかない場合はpaid_followup_needed=trueとする。ただ質問を増やすためには選ばない。十分ならpaid_followup_needed=falseとquestions=[]。必要なら候補から3〜5問を目安に最小限選ぶ。既回答・同じテーマ・答えたくない内容は聞かない。最大5問。危険があればquestions=[]。`,
      paidSelectionSchema,
      { ...organizeAnswers(answers, selected), catalog: candidates },
      options,
    );
    if (result.risk_detected) {
      await safetyStop(id);
      return false;
    }
    const next = result.paid_followup_needed
      ? selectKnown(
          candidates,
          result.questions,
          selected,
          { paid_followup: 5 },
          5,
        ).map(polish)
      : [];
    flow = {
      ...flow,
      paid_checked: true,
      paid_followup_needed: next.length > 0,
    };
    await savePlan(id, flow, next);
    if (next.length)
      checked(
        await db()
          .from("analytics_events")
          .insert({
            event_name: "paid_followup_started",
            metadata: { diagnosis_id: id, count: next.length },
          }),
      );
    selected = [...selected, ...next];
  }
  if (
    selected
      .filter((q) => q.phase === "paid_followup")
      .some((q) => !answers.some((a) => a.question_key === q.question_key))
  )
    return false;
  await savePlan(id, { ...flow, paid_completed: true }, []);
  checked(
    await db()
      .from("analytics_events")
      .insert({
        event_name: "paid_followup_completed",
        metadata: {
          diagnosis_id: id,
          count: selected.filter((q) => q.phase === "paid_followup").length,
        },
      }),
  );
  return true;
}
export async function getPublicFlow(id: string, paid = false) {
  return (await selectedQuestions(id))
    .filter((q) =>
      paid ? q.phase === "paid_followup" : q.phase !== "paid_followup",
    )
    .map(publicQuestion);
}
