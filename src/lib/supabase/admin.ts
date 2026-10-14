import "server-only";
import { createClient } from "@supabase/supabase-js";
import { required } from "../config";
export function db() {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export function checked<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error("Database operation failed", { cause: r.error });
  return r.data;
}

export function present<T>(value: T | null): T {
  if (value === null) throw new Error("Required data missing");
  return value;
}
