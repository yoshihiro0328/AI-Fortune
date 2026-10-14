import { trialApi, sendTurn } from "@/lib/trial/server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  return trialApi(() => sendTurn(req));
}
