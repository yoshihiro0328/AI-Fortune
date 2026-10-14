import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { receiptJobs, dispatchMail } from "@/lib/mail";
import { api, csrf, body, identity, rate, rateIP, HttpError } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
import { contactSchema } from "@/lib/contact-validation";
export const maxDuration = 60;
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
    const id = randomUUID();
    const jobs = receiptJobs(id, input.email);
    checked(
      await db().rpc("submit_contact", {
        p_id: id,
        p_name: input.name,
        p_email: input.email,
        p_message: input.message,
        p_user: who.userId,
        p_jobs: jobs,
      }),
    );
    if (jobs.length)
      after(async () => {
        await dispatchMail(id);
      });
    return { ok: true, id, mailQueued: jobs.length > 0 };
  });
}
