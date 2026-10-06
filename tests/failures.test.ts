import { describe, it, expect, vi, afterEach } from "vitest";
import { request } from "../src/lib/client";
import { stripe } from "../src/lib/stripe/client";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("provider and network failures", () => {
  it("network errors have Japanese guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network details")),
    );
    await expect(request("/api/test")).rejects.toThrow("通信できませんでした");
  });
  it("gateway HTML does not expose raw error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>upstream secret</html>", { status: 502 }),
        ),
    );
    await expect(request("/api/test")).rejects.toThrow(
      "ただいま処理を完了できません",
    );
  });
  it.each(["OpenAI", "Supabase", "Stripe"])(
    "%s service failure is recoverable",
    async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              {
                error:
                  "ただいま処理を完了できませんでした。時間をおいて再度お試しください。",
              },
              { status: 503 },
            ),
          ),
      );
      await expect(request("/api/test", {})).rejects.toThrow(
        "再度お試しください",
      );
    },
  );
  it("prevents enabling live Stripe by replacing a key", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_test_fixture");
    expect(() => stripe()).toThrow("Only Stripe sandbox keys");
  });
});
