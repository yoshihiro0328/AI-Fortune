import { trialApi, readSession, createSession } from "@/lib/trial/server";
export const runtime = "nodejs";
export async function GET() {
  return trialApi(readSession);
}
export async function POST(req: Request) {
  return trialApi(() => createSession(req));
}
