import { trialApi, claimSession } from "@/lib/trial/server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  return trialApi(() => claimSession(req));
}
