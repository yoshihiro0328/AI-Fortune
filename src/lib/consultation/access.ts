import "server-only";
import { identity, HttpError } from "@/lib/http";
import { checked, db } from "@/lib/supabase/admin";
import { z } from "zod";
export async function member() {
  const who = await identity();
  if (!who.userId)
    throw new HttpError(
      401,
      "続きから相談するにはログインしてください。新規登録した方は、確認メールの手続きも必要です。",
    );
  return who.userId;
}
export async function ownThread(user: string, id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new HttpError(404, "相談が見つかりません。");
  const thread = checked(
    await db()
      .from("consultation_threads")
      .select("*")
      .eq("id", id)
      .eq("user_id", user)
      .neq("title", "[削除済み]")
      .maybeSingle(),
  );
  if (!thread) throw new HttpError(404, "相談が見つかりません。");
  const subject = checked(
    await db()
      .from("consultation_subjects")
      .select("*")
      .eq("id", thread.subject_id)
      .eq("user_id", user)
      .neq("nickname", "[削除済み]")
      .maybeSingle(),
  );
  if (!subject) throw new HttpError(404, "相談相手が見つかりません。");
  return { thread, subject };
}
