import { api } from "@/lib/http";
import { serviceSettings } from "@/lib/service-settings";
import { pricing } from "@/lib/pricing";
export async function GET() {
  return api(async () => ({ pricing, limits: await serviceSettings() }));
}
