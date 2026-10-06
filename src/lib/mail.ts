import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, checked } from "./supabase/admin";
import { mailConfig } from "./mail-config";
import { appUrl, required } from "./config";
export const mailPayloadSchema = z.object({
  from: z.email(),
  to: z.array(z.email()).length(1),
  reply_to: z.email(),
  subject: z.string().max(200),
  text: z.string().max(10000),
});
export function receiptJobs(id: string, email: string) {
  const c = mailConfig();
  if (!c) return [];
  return [
    {
      kind: "receipt",
      dedupe_key: `receipt/${id}`,
      payload: {
        from: c.from,
        to: [email],
        reply_to: c.replyTo,
        subject: "【よりそい】お問い合わせを受け付けました",
        text: `お問い合わせありがとうございます。内容を確認し、必要に応じて担当者からご連絡します。\n受付番号：${id}\n\nこのメールに心当たりがない場合は、そのまま削除してください。\nよりそい\n${appUrl()}/contact`,
      },
    },
    {
      kind: "notification",
      dedupe_key: `notification/${id}`,
      payload: {
        from: c.from,
        to: [c.notifyTo],
        reply_to: c.replyTo,
        subject: "【よりそい】新しいお問い合わせ",
        text: `受付番号：${id}\n運営画面で内容を確認してください。\n${appUrl()}/admin/contact\n\n問い合わせ本文はこの通知に含めていません。`,
      },
    },
  ];
}
export async function dispatchMail(contactId?: string) {
  if (!mailConfig()) return { checked: 0 };
  const token = randomUUID();
  const jobs = checked(
    await db().rpc("claim_contact_mail", {
      p_token: token,
      p_contact: contactId ?? null,
    }),
  );
  for (const job of jobs ?? []) {
    try {
      const payload = mailPayloadSchema.parse(job.payload);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${required("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": job.dedupe_key,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Mail provider declined request");
      const result = z
        .object({ id: z.string().min(1) })
        .parse(await response.json());
      checked(
        await db()
          .from("contact_mail")
          .update({
            status: "accepted",
            provider_id: result.id,
            lease_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id)
          .eq("lease_token", token),
      );
    } catch {
      // Retry uses the exact persisted payload and idempotency key. No provider detail or PII is logged.
      await db()
        .from("contact_mail")
        .update({
          status: "failed",
          lease_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("lease_token", token);
    }
  }
  return { checked: jobs?.length ?? 0 };
}
