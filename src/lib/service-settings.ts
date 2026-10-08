import "server-only";
import { db, checked } from "@/lib/supabase/admin";
export async function serviceSettings() {
  const s = checked(
    await db()
      .from("service_settings")
      .select("free_limit,plus_limit")
      .eq("id", true)
      .single(),
  );
  if (!s) throw new Error("Service settings unavailable");
  return s as { free_limit: number; plus_limit: number };
}
