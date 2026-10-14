import { dispatchMail } from "@/lib/mail";
import { secureEqual } from "@/lib/security";
import { required } from "@/lib/config";
export const maxDuration = 60;
export async function GET(req: Request) {
  if (
    !secureEqual(
      req.headers.get("authorization") ?? "",
      "Bearer " + required("CRON_SECRET"),
    )
  )
    return new Response("Unauthorized", { status: 401 });
  return Response.json(await dispatchMail());
}
