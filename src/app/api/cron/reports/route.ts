import { db, checked } from "@/lib/supabase/admin";
import { generatePaid } from "@/lib/ai/pipeline";
import { required } from "@/lib/config";
import { secureEqual } from "@/lib/security";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (
    !secureEqual(
      req.headers.get("authorization") ?? "",
      "Bearer " + required("CRON_SECRET"),
    )
  )
    return new Response("Unauthorized", { status: 401 });
  const jobs = checked(
    await db()
      .from("paid_reports")
      .select("diagnosis_id")
      .in("status", ["queued", "failed", "generating"])
      .lt("attempts", 5)
      .order("updated_at")
      // One report may use two 120s AI attempts within this route's 300s budget.
      .limit(1),
  );
  for (const j of jobs ?? []) {
    try {
      await generatePaid(j.diagnosis_id);
    } catch {
      console.error("retry_report_failed", { diagnosis_id: j.diagnosis_id });
    }
  }
  return Response.json({ checked: jobs?.length ?? 0 });
}
