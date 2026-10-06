import { createClient } from "@supabase/supabase-js";
import { api } from "@/lib/http";
import { required } from "@/lib/config";
import { checked } from "@/lib/supabase/admin";
export async function GET() {
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
    return checked(
      await client
        .from("diagnosis_questions")
        .select(
          "id,question_key,question_text,question_type,options_json,placeholder,required,sort_order",
        )
        .eq("diagnosis_type_id", d!.id)
        .order("sort_order"),
    );
  });
}
