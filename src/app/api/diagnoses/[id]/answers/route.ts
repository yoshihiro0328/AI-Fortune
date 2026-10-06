import { z } from "zod";
import { api, csrf, owned, body, event, HttpError, rate } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
import { lock } from "@/lib/ai/pipeline";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    csrf(req);
    const { id } = await params;
    const d = await owned(id);
    await rate("answers:" + id, 100, 3600);
    const v = await body(
      req,
      z.object({
        key: z.string().min(1).max(60),
        answer: z.string().trim().min(1).max(2000),
      }),
    );
    return lock("diagnosis:" + id, async () => {
      const state = checked(
        await db().from("diagnoses").select("status").eq("id", id).single(),
      );
      const previous = checked(
        await db()
          .from("diagnosis_answers")
          .select("answer_text")
          .eq("diagnosis_id", id)
          .eq("question_key", v.key)
          .maybeSingle(),
      );
      if (previous?.answer_text === v.answer) return { saved: true };
      const analysis = checked(
        await db()
          .from("diagnosis_analyses")
          .select("id")
          .eq("diagnosis_id", id)
          .maybeSingle(),
      );
      if (analysis)
        throw new HttpError(409, "分析済みの回答は変更できません。");
      if (!["answering", "followup", "failed"].includes(state!.status))
        throw new HttpError(409, "分析開始後は回答を変更できません。");
      const q = checked(
        await db()
          .from("diagnosis_questions")
          .select("*")
          .eq("diagnosis_type_id", d.diagnosis_type_id)
          .eq("question_key", v.key)
          .eq("is_active", true)
          .maybeSingle(),
      );
      const follow = d.followup_json?.questions?.find(
        (q: { key: string }) => q.key === v.key,
      );
      if (!q && !follow) throw new HttpError(400, "質問が見つかりません。");
      if (
        q &&
        ["radio", "select"].includes(q.question_type) &&
        !q.options_json.includes(v.answer)
      )
        throw new HttpError(400, "選択肢から回答してください。");
      if (d.classification_json && q)
        throw new HttpError(
          409,
          "追加質問に進んだ後は基本回答を変更できません。",
        );
      checked(
        await db()
          .from("diagnosis_answers")
          .upsert(
            {
              diagnosis_id: id,
              question_id: q?.id ?? null,
              question_key: v.key,
              question_text: q?.question_text ?? follow.question,
              answer_text: v.answer,
              is_follow_up: !q,
            },
            { onConflict: "diagnosis_id,question_key" },
          ),
      );
      await event("question_answered", id);
      return { saved: true };
    });
  });
}
