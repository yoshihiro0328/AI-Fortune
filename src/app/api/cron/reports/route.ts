import { safeOperationalLog } from "@/lib/production/log";
import { db, checked } from "@/lib/supabase/admin";
import { generatePaid } from "@/lib/ai/pipeline";
import { required } from "@/lib/config";
import { secureEqual } from "@/lib/security";
import { syncSubscription } from "@/lib/stripe/subscriptions";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (
    !secureEqual(
      req.headers.get("authorization") ?? "",
      "Bearer " + required("CRON_SECRET"),
    )
  )
    return new Response("Unauthorized", { status: 401 });
  checked(await db().rpc("prune_deleted_consultations"));
  const subscriptions = checked(
    await db()
      .from("subscriptions")
      .select("id")
      .in("status", ["active", "past_due", "unpaid", "incomplete"])
      .order("updated_at")
      .limit(10),
  );
  for (const subscription of subscriptions ?? []) {
    try {
      await syncSubscription(subscription.id);
    } catch {
      safeOperationalLog("subscription_reconciliation_failed");
    }
  }
  const jobs = checked(
    await db()
      .from("paid_reports")
      .select("diagnosis_id")
      .in("status", ["queued", "failed", "generating"])
      .lt("attempts", 5)
      .order("updated_at")
      // Resume saved generation/editorial stages within a 265s budget.
      .limit(1),
  );
  for (const j of jobs ?? []) {
    try {
      await generatePaid(j.diagnosis_id);
    } catch {
      safeOperationalLog("retry_report_failed");
    }
  }
  return Response.json({ checked: jobs?.length ?? 0 });
}
