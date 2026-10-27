import { z } from "zod";
import { api, body, csrf, HttpError, rate } from "@/lib/http";
import { member } from "@/lib/consultation/access";
import { db, checked } from "@/lib/supabase/admin";
import {
  eventCreate,
  eventUpdate,
  eventDelete,
} from "@/lib/consultation/events";
function available() {
  if (process.env.CONSULTATION_EVENTS_ENABLED !== "true")
    throw new HttpError(404, "この機能は現在利用できません。");
}
export async function GET(req: Request) {
  return api(async () => {
    available();
    const user = await member();
    await rate("events-read:" + user, 120, 3600);
    const subject = z
      .uuid()
      .parse(new URL(req.url).searchParams.get("subject"));
    return {
      events: checked(
        await db()
          .from("consultation_events")
          .select("id,subject_id,event_date,text,source_type,revision")
          .eq("user_id", user)
          .eq("subject_id", subject)
          .order("event_date", { ascending: false })
          .order("id", { ascending: false })
          .limit(200),
      ),
    };
  });
}
async function mutate(req: Request, action: "create" | "update" | "delete") {
  return api(async () => {
    available();
    csrf(req);
    const user = await member();
    await rate("events-write:" + user, 60, 3600);
    const v = await body(req, z.union([eventCreate, eventUpdate, eventDelete]));
    const input = (
      action === "create"
        ? eventCreate
        : action === "update"
          ? eventUpdate
          : eventDelete
    ).safeParse(v);
    if (!input.success) throw new HttpError(400, "入力内容をご確認ください。");
    const data = input.data;
    const result = checked(
      await db().rpc("manage_consultation_event", {
        p_user: user,
        p_action: action,
        p_id: data.id,
        p_subject: "subject" in data ? data.subject : null,
        p_date: "date" in data ? data.date : null,
        p_text: "text" in data ? data.text : null,
        p_revision: "revision" in data ? data.revision : null,
      }),
    );
    if (result.error)
      throw new HttpError(
        result.error === "not_found" ? 404 : 409,
        result.error === "conflict"
          ? "別の操作で更新されています。内容を再確認してください。"
          : "保存できませんでした。対象と件数をご確認ください。",
      );
    return { event: result };
  });
}
export const POST = (req: Request) => mutate(req, "create");
export const PATCH = (req: Request) => mutate(req, "update");
export const DELETE = (req: Request) => mutate(req, "delete");
