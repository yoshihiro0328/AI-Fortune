import { createClient } from "@supabase/supabase-js";
import { api } from "@/lib/http";
import { required } from "@/lib/config";
import { checked, db } from "@/lib/supabase/admin";
export async function GET(req: Request) {
  return api(async () => {
    const client = createClient(
      required("NEXT_PUBLIC_SUPABASE_URL"),
      required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    );
    const d = checked(
      await client
        .from("diagnosis_types")
        .select("id")
        .eq("slug", "partner-mind")
        .single(),
    );
    const isV2 = new URL(req.url).searchParams.get("flow") === "v2";
    return checked(
      await (isV2 ? db() : client)
        .from("diagnosis_questions")
        .select(
          "id,question_key,question_text,question_type,options_json,placeholder,required,sort_order",
        )
        .eq("diagnosis_type_id", d!.id)
        .eq("flow_version", isV2 ? "v2" : "v1")
        .eq("phase", "common")
        .eq("is_active", true)
        .order("sort_order"),
    );
  });
}
