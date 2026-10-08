import { z } from "zod";
import { api, csrf, body, event, owned, identity, rate } from "@/lib/http";
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    const v = await body(
      req,
      z.object({
        name: z.enum([
          "page_view",
          "plans_viewed",
          "service_share",
          "diagnosis_abandoned",
          "free_report_viewed",
          "paid_cta_clicked",
          "paid_report_viewed",
        ]),
        id: z.uuid().optional(),
        source: z
          .enum(["direct", "guide", "share", "account", "home"])
          .optional(),
      }),
    );
    const who = await identity(true);
    await rate("events:" + who.session, 100, 3600);
    if (v.id) await owned(v.id);
    await event(v.name, v.id, {
      source: v.source ?? "direct",
      variant: "continuation-v1",
    });
    return { ok: true };
  });
}
