import { api, csrf, body, identity, rate, rateIP, HttpError } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
import { contactSchema } from "@/lib/contact-validation";
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    await rateIP(req, "contact", 5, 3600);
    const who = await identity(true);
    await rate("contact:" + who.session, 3, 3600);
    const input = await body(req, contactSchema);
    if (input.website) return { ok: true };
    if (
      Date.now() - input.startedAt < 2000 ||
      input.startedAt < Date.now() - 86400000
    )
      throw new HttpError(400, "内容を確認して、もう一度送信してください。");
    const row = checked(
      await db()
        .from("contact_messages")
        .insert({
          name: input.name,
          email: input.email,
          message: input.message,
          user_id: who.userId,
        })
        .select("id")
        .single(),
    );
    return { ok: true, id: row!.id };
  });
}
