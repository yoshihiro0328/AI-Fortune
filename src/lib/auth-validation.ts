import { z } from "zod";
export const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-zA-Z]/)
  .regex(/[0-9]/);
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const authSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("signup"),
    email,
    password: passwordSchema,
    consent: z.literal(true),
  }),
  z.object({
    action: z.literal("login"),
    email,
    password: z.string().min(1).max(128),
  }),
  ...["resend", "reset"].map((action) =>
    z.object({ action: z.literal(action), email }),
  ),
  z.object({ action: z.literal("update"), password: passwordSchema }),
  z.object({ action: z.literal("logout") }),
  z.object({ action: z.literal("claim") }),
]);
export function authMessage(code?: string) {
  if (code === "invalid_credentials")
    return "メールアドレスまたはパスワードをご確認ください。";
  if (code === "email_not_confirmed")
    return "メール認証がまだ完了していません。確認メールを開くか、再送してください。";
  if (code?.includes("rate_limit"))
    return "送信回数が多くなっています。時間をおいてお試しください。";
  if (code === "weak_password")
    return "パスワードは英字と数字を含む12文字以上で設定してください。";
  if (code === "same_password")
    return "現在とは異なるパスワードを設定してください。";
  if (code === "otp_expired")
    return "リンクの有効期限が切れています。メールを再送してください。";
  return "認証を完了できませんでした。入力内容を確認し、時間をおいてお試しください。";
}
