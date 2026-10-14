import { z } from "zod";
export function mailConfig() {
  const email = z.email().max(254);
  const from = email.safeParse(process.env.EMAIL_FROM);
  const reply = email.safeParse(process.env.EMAIL_REPLY_TO);
  const notify = email.safeParse(process.env.CONTACT_NOTIFY_TO);
  if (
    process.env.MAIL_ENABLED !== "true" ||
    !process.env.RESEND_API_KEY ||
    !from.success ||
    !reply.success ||
    !notify.success
  )
    return null;
  return { from: from.data, replyTo: reply.data, notifyTo: notify.data };
}
export function allowedOperator(
  user: { id: string; email_confirmed_at?: string | null } | null,
  ids = process.env.OPERATOR_USER_IDS ?? "",
) {
  return (
    !!user?.email_confirmed_at &&
    ids
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(user.id)
  );
}
