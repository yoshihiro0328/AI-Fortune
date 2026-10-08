import { z } from "zod";
import { api, csrf, owned, body, rate } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    csrf(req);
    const { id } = await params;
    await owned(id);
    await rate("question-view:" + id, 150, 3600);
    const { key } = await body(req, z.object({ key: z.string().max(60) }));
    checked(
      await db().rpc("view_dynamic_question", { p_diagnosis: id, p_key: key }),
    );
    return { ok: true };
  });
}
