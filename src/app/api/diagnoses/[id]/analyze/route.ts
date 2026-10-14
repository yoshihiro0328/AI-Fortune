import { api, csrf, owned, rate } from "@/lib/http";
import { analyzeDiagnosis } from "@/lib/ai/pipeline";
export const maxDuration = 300;
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    csrf(req);
    const { id } = await params;
    await owned(id);
    await rate("analyze:" + id, 12, 86400);
    const result = await analyzeDiagnosis(id);
    return result;
  });
}
