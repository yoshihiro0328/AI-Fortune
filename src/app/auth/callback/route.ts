import { NextResponse } from "next/server";
import { authClient } from "@/lib/http";
import { claimDiagnoses, setRecovery } from "@/lib/auth";
import { appUrl } from "@/lib/config";
export async function GET(req: Request) {
  const url = new URL(req.url),
    code = url.searchParams.get("code");
  const redirect = (path: string) =>
    NextResponse.redirect(appUrl() + path, {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  if (!code) return redirect("/account?error=auth");
  try {
    const auth = await authClient();
    const { data, error } = await auth.auth.exchangeCodeForSession(code);
    if (error || !data.user?.email_confirmed_at)
      return redirect("/account?error=auth");
    if (url.searchParams.get("next") === "recovery") {
      await setRecovery(data.user.id);
      return redirect("/account?mode=update");
    }
    await claimDiagnoses(data.user);
    return redirect("/account?verified=1");
  } catch {
    return redirect("/account?error=auth");
  }
}
