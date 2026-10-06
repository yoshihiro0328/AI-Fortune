import { after } from "next/server";
import { z } from "zod";
import { api, csrf, body, authClient, HttpError, rate } from "@/lib/http";
import { allowedOperator, mailConfig } from "@/lib/mail-config";
import { dispatchMail } from "@/lib/mail";
import { db, checked } from "@/lib/supabase/admin";
import { lock } from "@/lib/ai/pipeline";
export const maxDuration = 60;
async function operator() {
  const { data } = await (await authClient()).auth.getUser();
  if (!allowedOperator(data.user))
    throw new HttpError(403, "運営担当者のみ利用できます。");
  return data.user!;
}
export async function GET(req: Request) {
  return api(async () => {
    await operator();
    const offset = Math.max(
      0,
      Math.min(10000, Number(new URL(req.url).searchParams.get("offset")) || 0),
    );
    const messages = checked(
      await db()
        .from("contact_messages")
        .select(
          "id,name,email,message,status,admin_note,created_at,resolved_at,contact_mail(id,kind,status,attempts,provider_id,created_at)",
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + 19),
    );
    return { messages, mailConfigured: !!mailConfig() };
  });
}
const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    id: z.uuid(),
    status: z.enum(["open", "in_progress", "resolved", "spam"]),
    note: z.string().max(5000),
  }),
  z.object({
    action: z.literal("reply"),
    id: z.uuid(),
    requestId: z.uuid(),
    message: z.string().trim().min(1).max(5000),
  }),
  z.object({ action: z.literal("retry"), id: z.uuid() }),
]);
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    const user = await operator();
    await rate(`operator:${user.id}`, 30, 3600);
    const input = await body(req, inputSchema);
    return lock(`contact:${input.id}`, async () => {
      const contact = checked(
        await db()
          .from("contact_messages")
          .select("id,email,status")
          .eq("id", input.id)
          .maybeSingle(),
      );
      if (!contact) throw new HttpError(404, "お問い合わせが見つかりません。");
      if (input.action === "update") {
        checked(
          await db()
            .from("contact_messages")
            .update({
              status: input.status,
              admin_note: input.note,
              resolved_at:
                input.status === "resolved" ? new Date().toISOString() : null,
            })
            .eq("id", input.id),
        );
      } else {
        const c = mailConfig();
        if (!c)
          throw new HttpError(
            409,
            "送信元・返信先・メールサービスの設定を完了してください。",
          );
        if (input.action === "reply") {
          const dedupe = `reply/${input.id}/${input.requestId}`;
          const existing = checked(
            await db()
              .from("contact_mail")
              .select("payload")
              .eq("dedupe_key", dedupe)
              .maybeSingle(),
          );
          const text = `${input.message}\n\n受付番号：${contact.id}\nよりそい`;
          if (existing && existing.payload.text !== text)
            throw new HttpError(
              409,
              "同じ送信番号の返信内容は変更できません。",
            );
          if (!existing)
            checked(
              await db()
                .from("contact_mail")
                .insert({
                  contact_id: contact.id,
                  kind: "reply",
                  dedupe_key: dedupe,
                  payload: {
                    from: c.from,
                    to: [contact.email],
                    reply_to: c.replyTo,
                    subject: "【よりそい】お問い合わせへの回答",
                    text,
                  },
                }),
            );
        }
        after(async () => {
          await dispatchMail(contact.id);
        });
      }
      return { ok: true };
    });
  });
}
