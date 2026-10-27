import { rememberReturn, consumeReturn } from "@/lib/auth-return-server";
import { safeReturnTo } from "@/lib/auth-return";
import { db, checked } from "@/lib/supabase/admin";
import { authMailAllowed } from "@/lib/auth-mail";
import { localSubscriptionIntegration } from "@/lib/stripe/local-subscription";
import { localPaymentIntegration } from "@/lib/stripe/local-integration";
import { cookies } from "next/headers";
import {
  api,
  csrf,
  body,
  authClient,
  identity,
  rate,
  HttpError,
  rateIP,
} from "@/lib/http";
import { appUrl, required } from "@/lib/config";
import { authSchema, authMessage } from "@/lib/auth-validation";
import { claimDiagnoses, rotateAnonymous, canRecover } from "@/lib/auth";
import { sessionHash } from "@/lib/security";
export async function GET() {
  return api(async () => {
    const auth = await authClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    const who = await identity();
    const unsaved = who.session
      ? checked(
          await db()
            .from("diagnoses")
            .select("id")
            .eq("anonymous_session_id", who.session)
            .is("user_id", null)
            .limit(1),
        )
      : [];
    return {
      hasUnsaved: !!unsaved?.length,
      user: user
        ? { email: user.email, confirmed: !!user.email_confirmed_at }
        : null,
      recovery: user ? await canRecover(user.id) : false,
    };
  });
}
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    const input = await body(req, authSchema);
    if (
      (localPaymentIntegration() || localSubscriptionIntegration()) &&
      input.action !== "login"
    )
      throw new HttpError(
        403,
        "決済検証では既存アカウントのログインだけを使用します。",
      );
    // Refuse before session creation, database access, or an email request.
    if (!authMailAllowed(input.action))
      throw new HttpError(
        503,
        "現在、確認・再設定メールの送信を停止しています。時間をおいてご確認ください。",
      );
    const who = await identity(true);
    const action = input.action;
    await rateIP(req, "auth", 40, 3600);
    // Signup attempts share a daily IP budget across browser sessions and email addresses.
    // Existing accounts, monthly consultation limits and purchases remain unaffected.
    if (action === "signup") await rateIP(req, "auth-signup", 3, 86400);
    await rate(
      "auth:" + action + ":" + who.session,
      action === "login" ? 10 : 5,
      3600,
    );
    if ("email" in input)
      await rate(
        "auth-email:" +
          action +
          ":" +
          sessionHash(input.email, required("SESSION_SECRET")),
        action === "login" ? 10 : 3,
        3600,
      );
    const auth = await authClient();
    if (action === "logout") {
      const { error } = await auth.auth.signOut({ scope: "local" });
      if (error) throw error;
      (await cookies()).delete("yorisoi_recovery");
      await rotateAnonymous();
      await consumeReturn();
      return { ok: true };
    }
    if (action === "claim" || action === "update") {
      const {
        data: { user },
      } = await auth.auth.getUser();
      if (!user) throw new HttpError(401, "ログインしてください。");
      if (action === "claim")
        return { ok: true, count: await claimDiagnoses(user) };
      if (!(await canRecover(user.id)))
        throw new HttpError(403, "再設定メールのリンクを開き直してください。");
      const { error } = await auth.auth.updateUser({
        password: (input as { password: string }).password,
      });
      if (error) throw new HttpError(400, authMessage(error.code));
      (await cookies()).delete("yorisoi_recovery");
      await auth.auth.signOut({ scope: "global" });
      await rotateAnonymous();
      return {
        ok: true,
        message:
          "パスワードを更新しました。新しいパスワードでログインしてください。",
      };
    }
    if (action === "login" && "password" in input && "email" in input) {
      const { data, error } = await auth.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
      if (error) throw new HttpError(400, authMessage(error.code));
      if (!data.user.email_confirmed_at) {
        await auth.auth.signOut();
        throw new HttpError(
          403,
          "確認メールのリンクを開き、メールアドレスの確認を完了してください。",
        );
      }
      await claimDiagnoses(data.user);
      await consumeReturn();
      return { ok: true, returnTo: safeReturnTo(input.returnTo) };
    }
    if (!("email" in input))
      throw new HttpError(400, "入力内容をご確認ください。");
    if (action === "signup" || action === "resend")
      await rememberReturn(input.returnTo);
    let error;
    if (action === "signup" && "password" in input)
      ({ error } = await auth.auth.signUp({
        email: input.email,
        password: input.password,
        options: { emailRedirectTo: appUrl() + "/auth/callback" },
      }));
    else if (action === "resend")
      ({ error } = await auth.auth.resend({
        type: "signup",
        email: input.email,
        options: { emailRedirectTo: appUrl() + "/auth/callback" },
      }));
    else if (action === "reset")
      ({ error } = await auth.auth.resetPasswordForEmail(input.email, {
        redirectTo: appUrl() + "/auth/callback?next=recovery",
      }));
    else throw new HttpError(400, "入力内容をご確認ください。");
    if (error) throw new HttpError(400, authMessage(error.code));
    return {
      ok: true,
      message:
        action === "reset"
          ? "登録されている場合は再設定メールをお送りします。このブラウザでリンクを開いてください。"
          : "確認メールをご確認ください。届かない場合は迷惑メールフォルダを確認し、時間をおいて再送してください。既に登録済みの方はログインをご利用ください。",
    };
  });
}
