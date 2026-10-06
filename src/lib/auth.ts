import "server-only";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { db, checked } from "./supabase/admin";
import { identity, HttpError } from "./http";
import { newSession, sessionHash, secureEqual } from "./security";
import { required } from "./config";
export async function claimDiagnoses(user: User) {
  if (!user.email_confirmed_at)
    throw new HttpError(403, "メール認証を完了してください。");
  const who = await identity();
  return checked(
    await db().rpc("claim_anonymous_diagnoses", {
      p_user: user.id,
      p_session: who.session,
    }),
  );
}
export async function rotateAnonymous() {
  (await cookies()).set("yorisoi_session", newSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7776000,
  });
}
export async function setRecovery(userId: string) {
  const expires = Date.now() + 20 * 60 * 1000;
  const payload = userId + ":" + expires;
  (await cookies()).set(
    "yorisoi_recovery",
    payload + ":" + sessionHash(payload, required("SESSION_SECRET")),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 1200,
    },
  );
}
export async function canRecover(userId: string) {
  const value = (await cookies()).get("yorisoi_recovery")?.value;
  if (!value) return false;
  const [id, expires, signature] = value.split(":");
  return (
    id === userId &&
    Number(expires) > Date.now() &&
    !!signature &&
    secureEqual(
      signature,
      sessionHash(id + ":" + expires, required("SESSION_SECRET")),
    )
  );
}
