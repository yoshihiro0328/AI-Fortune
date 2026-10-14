import { trialApi, deleteContent } from "@/lib/trial/server";
export async function DELETE(req: Request) {
  return trialApi(() => deleteContent(req));
}
