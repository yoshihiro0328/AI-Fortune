import { z } from "zod";
import { api, body, csrf, HttpError, rate } from "@/lib/http";
import { member, ownThread } from "@/lib/consultation/access";
import { db, checked } from "@/lib/supabase/admin";
export async function GET(req: Request) {
  return api(async () => {
    const user = await member(),
      id = new URL(req.url).searchParams.get("thread");
    if (id) {
      const { thread, subject } = await ownThread(user, id);
      const before = new URL(req.url).searchParams.get("before");
      if (before && !z.iso.datetime({ offset: true }).safeParse(before).success)
        throw new HttpError(400, "日時を確認してください。");
      let q = db()
        .from("consultation_turns")
        .select(
          "id,thread_id,user_text,assistant_text,status,safety,generation,created_at",
        )
        .eq("thread_id", id)
        .eq("user_id", user)
        .neq("user_text", "[削除済み]");
      if (before) q = q.lt("created_at", before);
      const turns =
        checked(await q.order("created_at", { ascending: false }).limit(30)) ??
        [];
      return {
        thread,
        subject,
        turns: turns.reverse(),
        hasMore: turns.length === 30,
      };
    }
    const [subjects, threads, links, usage, subscription, billing] =
      await Promise.all([
        db()
          .from("consultation_subjects")
          .select("id,nickname,memory,memory_reset_at,updated_at")
          .eq("user_id", user)
          .neq("nickname", "[削除済み]")
          .order("updated_at", { ascending: false })
          .limit(50),
        db()
          .from("consultation_threads")
          .select("id,subject_id,title,updated_at")
          .eq("user_id", user)
          .neq("title", "[削除済み]")
          .order("updated_at", { ascending: false })
          .limit(200),
        db()
          .from("subject_diagnoses")
          .select("diagnosis_id,subject_id")
          .eq("user_id", user),
        db().rpc("consultation_entitlement", { p_user: user }),
        db()
          .from("subscriptions")
          .select(
            "id,amount,status,period_end,paid_through,cancel_at_period_end,cancel_at",
          )
          .eq("user_id", user)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db()
          .from("billing_customers")
          .select("user_id")
          .eq("user_id", user)
          .maybeSingle(),
      ]);
    return {
      subjects: checked(subjects),
      threads: checked(threads),
      links: checked(links),
      usage: checked(usage),
      subscription: checked(subscription),
      hasBilling: !!checked(billing),
    };
  });
}
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_subject"),
    nickname: z.string().trim().min(1).max(40),
  }),
  z.object({
    action: z.literal("create_thread"),
    subject: z.uuid(),
    title: z.string().trim().min(1).max(80).default("相談の続き"),
  }),
  z.object({
    action: z.literal("rename_subject"),
    id: z.uuid(),
    value: z.string().trim().min(1).max(40),
  }),
  z.object({
    action: z.literal("rename_thread"),
    id: z.uuid(),
    value: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("memory"),
    id: z.uuid(),
    notes: z.array(z.string().trim().min(1).max(500)).max(24),
  }),
  z.object({
    action: z.enum(["move_thread", "link_diagnosis"]),
    id: z.uuid(),
    target: z.uuid(),
  }),
  z.object({
    action: z.enum(["delete_subject", "delete_thread"]),
    id: z.uuid(),
  }),
]);
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    const user = await member();
    await rate("consultation-manage:" + user, 100, 3600);
    const input = await body(req, schema);
    if (input.action === "create_subject") {
      const count = await db()
        .from("consultation_subjects")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user)
        .neq("nickname", "[削除済み]");
      if (count.error) throw count.error;
      if ((count.count ?? 0) >= 40)
        throw new HttpError(
          409,
          "相談相手は40人まで保存できます。不要な相手を整理してください。",
        );
      return checked(
        await db()
          .from("consultation_subjects")
          .insert({ user_id: user, nickname: input.nickname })
          .select("id")
          .single(),
      );
    }
    if (input.action === "create_thread") {
      const subject = checked(
        await db()
          .from("consultation_subjects")
          .select("id")
          .eq("id", input.subject)
          .eq("user_id", user)
          .neq("nickname", "[削除済み]")
          .maybeSingle(),
      );
      if (!subject) throw new HttpError(404, "相談相手が見つかりません。");
      return checked(
        await db()
          .from("consultation_threads")
          .insert({
            user_id: user,
            subject_id: input.subject,
            title: input.title,
          })
          .select("id")
          .single(),
      );
    }
    const ok = checked(
      await db().rpc("manage_consultation", {
        p_user: user,
        p_action: input.action,
        p_id: input.id,
        p_target: "target" in input ? input.target : null,
        p_value: "value" in input ? input.value : null,
        p_memory:
          input.action === "memory"
            ? input.notes.map((quote) => ({
                kind: "note",
                quote,
                source: "user",
                at: new Date().toISOString(),
              }))
            : [],
      }),
    );
    if (!ok) throw new HttpError(404, "対象が見つかりません。");
    return { ok: true };
  });
}
