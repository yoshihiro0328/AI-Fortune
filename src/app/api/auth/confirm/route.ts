import { z } from "zod";
import { api, csrf, body, authClient, rateIP, HttpError } from "@/lib/http";
import { setRecovery } from "@/lib/auth";
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    await rateIP(req, "confirm", 15, 3600);
    const input = await body(
      req,
      z.object({
        token_hash: z.string().min(20).max(512),
        type: z.enum(["email", "signup", "recovery"]),
      }),
    );
    const auth = await authClient();
    const { data, error } = await auth.auth.verifyOtp(input);
    if (error || !data.user?.email_confirmed_at)
      throw new HttpError(
        400,
        "リンクが無効か、有効期限が切れています。確認メールを再送してください。",
      );
    if (input.type === "recovery") await setRecovery(data.user.id);
    // A token-hash link is not PKCE-bound: never auto-claim the current browser's diagnoses here.
    return { ok: true, recovery: input.type === "recovery" };
  });
}
