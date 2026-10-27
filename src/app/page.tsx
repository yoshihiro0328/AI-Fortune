import { serviceSettings } from "@/lib/service-settings";
import Home from "@/components/phase6/home";
import { connection } from "next/server";
import { trialAvailability } from "@/lib/trial/availability";
export default async function Page() {
  await connection();
  const availability = await trialAvailability();
  const settings = await serviceSettings().catch(() => null);
  return (
    <Home
      trialEnabled={availability.enabled}
      freeLimit={settings?.free_limit}
    />
  );
}
