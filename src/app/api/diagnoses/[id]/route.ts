import { getPublicFlow } from "@/lib/questions/engine";
import { api, owned } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const { id } = await params;
    const d = await owned(id);
    const [a, f, p] = await Promise.all([
      db()
        .from("diagnosis_answers")
        .select("question_key,answer_text")
        .eq("diagnosis_id", id),
      db()
        .from("free_reports")
        .select("report_json")
        .eq("diagnosis_id", id)
        .maybeSingle(),
      db()
        .from("payments")
        .select("status")
        .eq("diagnosis_id", id)
        .maybeSingle(),
    ]);
    return {
      id,
      status: d.status,
      question_flow_version: d.question_flow_version,
      questions:
        d.question_flow_version === "v2" ? await getPublicFlow(id) : undefined,
      answers: checked(a),
      free_report: checked(f)?.report_json ?? null,
      payment_status: checked(p)?.status ?? null,
      followup: (d.followup_json?.questions ?? []).map(
        (q: { key: string; question: string }) => ({
          question_key: q.key,
          question_text: q.question,
          question_type: "textarea",
          required: true,
          options_json: [],
        }),
      ),
    };
  });
}
