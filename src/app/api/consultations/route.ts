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
      const beforeId = new URL(req.url).searchParams.get("beforeId");
      if (beforeId && (!before || !z.uuid().safeParse(beforeId).success))
        throw new HttpError(400, "履歴の位置を確認してください。");
      if (before && beforeId)
        q = q.or(
          `created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`,
        );
      else if (before) q = q.lt("created_at", before);
      const turns =
        checked(
          await q
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(30),
        ) ?? [];
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
            "id,amount,status,period_end,ended_at,paid_through,cancel_at_period_end,cancel_at",
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
      ownerId: user,
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
    action: z.literal("search"),
    query: z.string().trim().min(2).max(80),
  }),
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
    if (input.action === "search") {
      const pattern = "%" + input.query.replace(/[\\%_]/g, "\\$&") + "%";
      const [names, titles, messages, replies] = await Promise.all([
        db()
          .from("consultation_subjects")
          .select("id")
          .eq("user_id", user)
          .neq("nickname", "[削除済み]")
          .ilike("nickname", pattern)
          .limit(40),
        db()
          .from("consultation_threads")
          .select("id")
          .eq("user_id", user)
          .neq("title", "[削除済み]")
          .ilike("title", pattern)
          .order("updated_at", { ascending: false })
          .limit(50),
        db()
          .from("consultation_turns")
          .select("thread_id")
          .eq("user_id", user)
          .neq("user_text", "[削除済み]")
          .ilike("user_text", pattern)
          .order("created_at", { ascending: false })
          .limit(100),
        db()
          .from("consultation_turns")
          .select("thread_id")
          .eq("user_id", user)
          .neq("user_text", "[削除済み]")
          .ilike("assistant_text", pattern)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      const subjectIds = (checked(names) ?? []).map((x) => x.id);
      const ids = [
        ...new Set([
          ...(checked(titles) ?? []).map((x) => x.id),
          ...(checked(messages) ?? []).map((x) => x.thread_id),
          ...(checked(replies) ?? []).map((x) => x.thread_id),
        ]),
      ];
      const byIds = ids.length
        ? (checked(
            await db()
              .from("consultation_threads")
              .select("id,subject_id,title,updated_at")
              .eq("user_id", user)
              .neq("title", "[削除済み]")
              .in("id", ids)
              .order("updated_at", { ascending: false })
              .limit(50),
          ) ?? [])
        : [];
      const byNames = subjectIds.length
        ? (checked(
            await db()
              .from("consultation_threads")
              .select("id,subject_id,title,updated_at")
              .eq("user_id", user)
              .neq("title", "[削除済み]")
              .in("subject_id", subjectIds)
              .order("updated_at", { ascending: false })
              .limit(50),
          ) ?? [])
        : [];
      return {
        threads: [
          ...new Map([...byIds, ...byNames].map((t) => [t.id, t])).values(),
        ]
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .slice(0, 50),
      };
    }
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
