import { api, csrf, identity, rate, event, owned } from "@/lib/http";
import { db, checked } from "@/lib/supabase/admin";
import { sessionHash } from "@/lib/security";
import { required } from "@/lib/config";
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    const who = await identity(true);
    await rate("start:" + who.session, 5, 86400);
    const ip = process.env.VERCEL
      ? (req.headers.get("x-vercel-forwarded-for") ?? "unknown")
      : "local";
    await rate("ip:" + sessionHash(ip, required("SESSION_SECRET")), 25, 86400);
    const type = checked(
      await db()
        .from("diagnosis_types")
        .select("id")
        .eq("slug", "partner-mind")
        .single(),
    );
    const d = checked(
      await db()
        .from("diagnoses")
        .insert({
          anonymous_session_id: who.session,
          user_id: who.userId,
          diagnosis_type_id: type!.id,
        })
        .select("id")
        .single(),
    );
    await event("diagnosis_started", d!.id);
    return d;
  });
}
export async function GET(req: Request) {
  return api(async () => {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const d = await owned(id);
      return { id: d.id, status: d.status };
    }
    const who = await identity();
    if (!who.session && !who.userId) return [];
    let q = db()
      .from("diagnoses")
      .select("id,status,created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    q = who.userId
      ? q.eq("user_id", who.userId)
      : q.eq("anonymous_session_id", who.session!).is("user_id", null);
    return checked(await q);
  });
}
