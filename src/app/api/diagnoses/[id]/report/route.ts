import { getPublicFlow } from "@/lib/questions/engine";
import { api, csrf, owned, rate, HttpError } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
import { generatePaid } from "@/lib/ai/pipeline";
export const maxDuration = 300;
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const { id } = await params;
    const d = await owned(id);
    if (d.status === "safety")
      return { status: "safety", report: null, attempts: 0 };
    const p = checked(
      await db()
        .from("payments")
        .select("status")
        .eq("diagnosis_id", id)
        .maybeSingle(),
    );
    if (p?.status !== "paid")
      throw new HttpError(
        403,
        p?.status === "refunded"
          ? "返金済みのレポートです。"
          : "決済確認を待っています。",
      );
    const r = checked(
      await db()
        .from("paid_reports")
        .select("status,report_json,attempts")
        .eq("diagnosis_id", id)
        .maybeSingle(),
    );
    return {
      questions:
        d.question_flow_version === "v2" ? await getPublicFlow(id, true) : [],
      answers: checked(
        await db()
          .from("diagnosis_answers")
          .select("question_key,answer_text")
          .eq("diagnosis_id", id),
      ),
      status:
        d.question_flow_json?.paid_followup_needed &&
        !d.question_flow_json?.paid_completed
          ? "paid_followup"
          : (r?.status ?? "queued"),
      report: r?.status === "ready" ? r.report_json : null,
      attempts: r?.attempts ?? 0,
    };
  });
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    csrf(req);
    const { id } = await params;
    await owned(id);
    const p = checked(
      await db()
        .from("payments")
        .select("status")
        .eq("diagnosis_id", id)
        .maybeSingle(),
    );
    if (p?.status !== "paid")
      throw new HttpError(403, "決済が確認できません。");
    await rate("report:" + id, 8, 3600);
    await generatePaid(id);
    return { ok: true };
  });
}
