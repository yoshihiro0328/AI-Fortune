import "server-only";
import { db, checked } from "@/lib/supabase/admin";
import { runtimeEnabled } from "./security";

export async function trialAvailability() {
  const paused = { enabled: false, maxLength: 800, retentionHours: 24 };
  if (!runtimeEnabled()) return paused;
  try {
    const result = checked(await db().rpc("trial_availability")) as {
      enabled: boolean;
      maxLength: number;
      retentionHours: number;
    } | null;
    return result?.enabled === true ? result : paused;
  } catch {
    // Missing migration, unavailable DB, stale cleanup or unknown price => no offer.
    return paused;
  }
}
