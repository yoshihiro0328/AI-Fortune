import { z } from "zod";
export const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[!@#$%^&*()_+\-=\[\]{};'\\:"|<>?,./`~]/);
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
    return "メールアドレスの確認がまだ完了していません。確認メールのリンクを開くか、メールを再送してください。";
  if (code?.includes("rate_limit"))
    return "送信回数が多くなっています。時間をおいてお試しください。";
  if (code === "weak_password")
    return "パスワードは英大文字・英小文字・数字・記号を含む12文字以上で設定してください。他のサービスと同じものは避けてください。";
  if (code === "email_address_not_authorized")
    return "現在、メールを使う登録・再設定は招待されたテスト参加者のみ利用できます。無料診断は登録せずに利用できます。";
  if (code === "same_password")
    return "現在とは異なるパスワードを設定してください。";
  if (code === "otp_expired")
    return "リンクの有効期限が切れています。メールを再送してください。";
  return "ログイン・登録の手続きを完了できませんでした。入力内容を確認し、時間をおいてお試しください。";
}
