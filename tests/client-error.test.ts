import { afterEach, expect, it, vi } from "vitest";
import { request, RequestError, isUnavailableDiagnosis } from "@/lib/client";
afterEach(() => vi.unstubAllGlobals());
it.each([401, 404, 429, 500])(
  "preserves HTTP status %i for safe resume recovery",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "確認してください" }), {
          status,
        }),
      ),
    );
    const error = await request("/api/diagnoses/example").catch((e) => e);
    if (!(error instanceof RequestError)) throw error;
    expect(error.status).toBe(status);
    expect(isUnavailableDiagnosis(error)).toBe([401, 404].includes(status));
  },
);
it("does not treat a network failure as a deleted diagnosis", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  const error = await request("/api/diagnoses/example").catch((e) => e);
  expect(isUnavailableDiagnosis(error)).toBe(false);
  if (!(error instanceof Error)) throw error;
  expect(error.message).toContain("通信できません");
});
