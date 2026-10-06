import { z } from "zod";
import { api, csrf, body, authClient, identity, rate } from "@/lib/http";
import { appUrl } from "@/lib/config";
export async function POST(req: Request) {
  return api(async () => {
    csrf(req);
    const who = await identity(true);
    await rate("auth:" + who.session, 3, 3600);
    const { email } = await body(req, z.object({ email: z.email().max(254) }));
    const auth = await authClient();
    const { error } = await auth.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: appUrl() + "/auth/callback" },
    });
    if (error) throw error;
    return { ok: true };
  });
}
