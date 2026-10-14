import { trialApi, rpc, TrialError } from "@/lib/trial/server";
import { secureEqual } from "@/lib/security";
export async function GET(req: Request) {
  return trialApi(async () => {
    const secret = process.env.TRIAL_CLEANUP_SECRET;
    if (
      !secret ||
      !secureEqual(req.headers.get("authorization") ?? "", "Bearer " + secret)
    )
      throw new TrialError("auth", 401, "認証が必要です。");
    return rpc("trial_cleanup");
  });
}
