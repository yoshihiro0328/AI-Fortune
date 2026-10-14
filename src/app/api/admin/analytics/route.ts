import { z } from "zod";
import { api, authClient, HttpError, csrf, body, rate } from "@/lib/http";
import { allowedOperator } from "@/lib/mail-config";
import { db, checked } from "@/lib/supabase/admin";
import { serviceSettings } from "@/lib/service-settings";
async function operator() {
  const { data } = await (await authClient()).auth.getUser();
  if (!allowedOperator(data.user))
    throw new HttpError(403, "運営担当者のみ利用できます。");
  return data.user!;
}
export async function GET(req: Request) {
  return api(async () => {
    const user = await operator();
    await rate("analytics:" + user.id, 60, 3600);
    const p = new URL(req.url).searchParams;
    const start =
      p.get("start") ??
      new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1,
      ).toISOString();
    const end = p.get("end") ?? new Date().toISOString();
    if (
      !z.iso.datetime({ offset: true }).safeParse(start).success ||
      !z.iso.datetime({ offset: true }).safeParse(end).success ||
      Date.parse(end) <= Date.parse(start) ||
      Date.parse(end) - Date.parse(start) > 93 * 86400000
    )
      throw new HttpError(400, "集計期間は93日以内で指定してください。");
    const includeTest = p.get("test") === "true";
    let registered = 0;
    if (includeTest) {
      for (let page = 1; ; page++) {
        const result = await db().auth.admin.listUsers({ page, perPage: 1000 });
        if (result.error) throw result.error;
        registered += result.data.users.filter(
          (u) =>
            u.email_confirmed_at &&
            Date.parse(u.created_at) >= Date.parse(start) &&
            Date.parse(u.created_at) < Date.parse(end),
        ).length;
        if (result.data.users.length < 1000) break;
      }
    }
    const metrics = checked(
      await db().rpc("growth_metrics", {
        p_start: start,
        p_end: end,
        p_test: includeTest,
      }),
    );
    return {
      start,
      end,
      includeTest,
      metrics: { ...metrics, registered },
      settings: await serviceSettings(),
    };
  });
}
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    const user = await operator();
    await rate("settings:" + user.id, 20, 3600);
    const v = await body(
      req,
      z.object({
        free_limit: z.number().int().min(0).max(100),
        plus_limit: z.number().int().min(1).max(1000),
      }),
    );
    checked(
      await db()
        .from("service_settings")
        .update({ ...v, updated_at: new Date().toISOString() })
        .eq("id", true),
    );
    return { ok: true };
  });
}
