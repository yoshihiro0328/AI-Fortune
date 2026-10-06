import { NextResponse } from "next/server";
import { authClient, identity, event } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/config";
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(appUrl() + "/account?error=auth");
  const who = await identity();
  const auth = await authClient();
  const { data, error } = await auth.auth.exchangeCodeForSession(code);
  if (error || !data.user)
    return NextResponse.redirect(appUrl() + "/account?error=auth");
  if (who.session)
    checked(
      await db()
        .from("diagnoses")
        .update({ user_id: data.user.id })
        .eq("anonymous_session_id", who.session)
        .is("user_id", null),
    );
  checked(
    await db()
      .from("profiles")
      .upsert({ user_id: data.user.id }, { onConflict: "user_id" }),
  );
  await event("signup_completed");
  return NextResponse.redirect(appUrl() + "/account");
}
