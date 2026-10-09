import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api, body, csrf, HttpError, rate } from "@/lib/http";
import { member, ownThread } from "@/lib/consultation/access";
import { db, checked } from "@/lib/supabase/admin";
import { chatAnswer, checkChatSafety } from "@/lib/consultation/ai";
import {
  groundedFacts,
  mergeMemory,
  type MemoryFact,
  type Usage,
} from "@/lib/consultation/model";
import { triageRisk } from "@/lib/risk";
export const maxDuration = 180;
const schema = z.object({
  requestId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
  regenerate: z.boolean().default(false),
  regenerationId: z.uuid().optional(),
});
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    csrf(req);
    const user = await member(),
      { id } = await params;
    await ownThread(user, id);
    const input = await body(req, schema);
    // Idempotent successful responses do not invoke the provider or spend quota again.
    const prior = checked(
      await db()
        .from("consultation_turns")
        .select("id,user_text,assistant_text,status,safety,regeneration_key")
        .eq("id", input.requestId)
        .eq("user_id", user)
        .eq("thread_id", id)
        .maybeSingle(),
    );
    if (prior && prior.user_text !== input.text)
      throw new HttpError(409, "再送する内容が元の相談と異なります。");
    if (
      prior?.status === "ready" &&
      (!input.regenerate ||
        (input.regenerationId &&
          prior.regeneration_key === input.regenerationId))
    )
      return {
        turn: prior,
        usage: checked(
          await db().rpc("consultation_entitlement", { p_user: user }),
        ),
      };
    await rate("consultation:" + user, 40, 3600);
    await rate("consultation-day:" + user, 100, 86400);
    const usage = checked(
      await db().rpc("consultation_entitlement", { p_user: user }),
    ) as Usage;
    let safe: { safety: boolean; answer: string } | null = null;
    if (triageRisk(input.text).level !== "none" || usage.remaining <= 0)
      safe = await checkChatSafety({ user, plan: usage.plan }, input.text);
    const token = randomUUID();
    const reservation = checked(
      await db().rpc("reserve_consultation", {
        p_user: user,
        p_thread: id,
        p_id: input.requestId,
        p_text: input.text,
        p_token: token,
        p_regenerate: input.regenerate,
        p_safety: safe?.safety ?? false,
        p_regeneration_key: input.regenerationId ?? null,
      }),
    );
    if (reservation.error) {
      const messages: Record<string, string> = {
        quota:
          "今の期間の相談回数を使い切りました。履歴は引き続き読めます。安全に関わる相談の案内は回数を使わずに受けられます。",
        busy: "別の回答を作成中です。少し待って同じ内容を再送してください。",
        regeneration:
          "この回答の再生成はできません。再生成は1回答につき3回までです。",
        conflict: "送信番号と相談内容が一致しません。",
        not_found: "相談が見つかりません。",
      };
      throw new HttpError(
        reservation.error === "not_found" ? 404 : 409,
        messages[reservation.error] ?? "再度お試しください。",
      );
    }
    if (reservation.cached) return { turn: reservation.turn, usage };
    try {
      const { subject } = await ownThread(user, id);
      // Restrict all sources to this account and this subject. Never concatenate every message.
      const threads =
        checked(
          await db()
            .from("consultation_threads")
            .select("id")
            .eq("subject_id", subject.id)
            .eq("user_id", user)
            .neq("title", "[削除済み]"),
        ) ?? [];
      let historyQuery = db()
        .from("consultation_turns")
        .select("id,user_text,assistant_text,created_at")
        .eq("user_id", user)
        .in(
          "thread_id",
          threads.map((t) => t.id),
        )
        .eq("status", "ready")
        .neq("id", input.requestId)
        .neq("user_text", "[削除済み]")
        .order("created_at", { ascending: false })
        .limit(8);
      if (subject.memory_reset_at)
        historyQuery = historyQuery.gte("created_at", subject.memory_reset_at);
      const history = (checked(await historyQuery) ?? []).reverse();
      let linksQuery = db()
        .from("subject_diagnoses")
        .select("diagnosis_id")
        .eq("subject_id", subject.id)
        .eq("user_id", user)
        .order("linked_at", { ascending: false })
        .limit(1);
      if (subject.memory_reset_at)
        linksQuery = linksQuery.gte("linked_at", subject.memory_reset_at);
      const links = checked(await linksQuery) ?? [];
      const diagnosis = links.length
        ? (checked(
            await db()
              .from("diagnosis_answers")
              .select("question_text,answer_text")
              .eq("diagnosis_id", links[0].diagnosis_id)
              .limit(22),
          ) ?? [])
        : [];
      const context = {
        memory: subject.memory,
        recent: history.map((h) => ({
          ...h,
          user_text: h.user_text.slice(0, 1500),
          assistant_text: h.assistant_text?.slice(0, 1500),
        })),
        diagnosis: diagnosis.map((a) => ({
          ...a,
          answer_text: a.answer_text.slice(0, 400),
        })),
        message: input.text,
        today: new Date().toISOString(),
        regenerate: input.regenerate,
      };
      const answer = safe?.safety
        ? { answer: safe.answer, safety: true, facts: [] }
        : await chatAnswer(
            { user, turn: input.requestId, plan: reservation.turn.plan },
            context,
          );
      if (!answer.answer.trim()) throw new Error("Empty answer");
      const facts = groundedFacts(
        answer.facts,
        input.text,
        answer.answer,
        input.requestId,
        new Date().toISOString(),
      );
      const memory = mergeMemory(
        subject.memory as MemoryFact[],
        facts,
        input.requestId,
      );
      const finished = checked(
        await db().rpc("finish_consultation", {
          p_user: user,
          p_id: input.requestId,
          p_token: token,
          p_answer: answer.answer,
          p_facts: facts,
          p_memory: memory,
          p_safety: answer.safety,
          p_success: true,
        }),
      );
      if (!finished)
        throw new HttpError(
          409,
          "処理が中断されました。同じ送信内容で再試行してください。",
        );
      return {
        turn: {
          id: input.requestId,
          user_text: input.text,
          assistant_text: answer.answer,
          safety: answer.safety,
          status: "ready",
        },
        usage: checked(
          await db().rpc("consultation_entitlement", { p_user: user }),
        ),
      };
    } catch (error) {
      await db().rpc("finish_consultation", {
        p_user: user,
        p_id: input.requestId,
        p_token: token,
        p_answer: null,
        p_facts: [],
        p_memory: [],
        p_safety: false,
        p_success: false,
      });
      throw error;
    }
  });
}
