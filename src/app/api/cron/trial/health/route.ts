import { trialApi, rpc, TrialError } from "@/lib/trial/server";
import { secureEqual } from "@/lib/security";

export async function GET(req: Request) {
  let healthy = false;
  const response = await trialApi(async () => {
    const secret = process.env.TRIAL_CLEANUP_SECRET;
    if (
      !secret ||
      !secureEqual(req.headers.get("authorization") ?? "", "Bearer " + secret)
    )
      throw new TrialError("auth", 401, "認証が必要です。");
    const result = await rpc<{ healthy: boolean }>("trial_health");
    healthy = result.healthy;
    return result;
  });
  if (response.ok && !healthy)
    return new Response(response.body, {
      status: 503,
      headers: response.headers,
    });
  return response;
}
