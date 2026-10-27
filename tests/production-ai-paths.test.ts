import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
const m = vi.hoisted(() => ({
  parse: vi.fn(),
  rpc: vi.fn(),
  construct: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    constructor(options: unknown) {
      m.construct(options);
    }
    responses = { parse: m.parse };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  db: () => ({
    rpc: m.rpc,
    from: () => ({
      insert: (value: unknown) => {
        m.insert(value);
        return {
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
          select: () => ({
            single: async () => ({ data: { id: "fixture-call" }, error: null }),
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
  checked: (r: { data?: unknown; error?: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
import { runAI } from "@/lib/ai/run";
import { checkChatSafety } from "@/lib/consultation/ai";
beforeEach(() => {
  vi.resetAllMocks();
  const env = {
    VERCEL_ENV: "production",
    PRODUCTION_ENVIRONMENT_ID: "synthetic-production",
    PRODUCTION_SUPABASE_REF: "abcdefghijklmnopqrst",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic",
    NEXT_PUBLIC_APP_URL: "https://example.org",
    PRODUCTION_PUBLIC_ORIGIN: "https://example.org",
    PRODUCTION_VERCEL_PROJECT_ID: "prj_fixture",
    VERCEL_PROJECT_ID: "prj_fixture",
    OPENAI_MODEL: "gpt-6-luna",
    OPENAI_CHAT_MODEL: "gpt-6-luna",
    PRODUCTION_OPENAI_PROJECT_ID: "proj_synthetic",
    STRIPE_MODE: "live",
    STRIPE_ACCOUNT_ID: "acct_synthetic",
    STRIPE_SECRET_KEY: "rk_live_synthetic",
    OPENAI_API_KEY: "synthetic",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic",
    SESSION_SECRET: "synthetic",
    CRON_SECRET: "synthetic",
    STRIPE_WEBHOOK_SECRET: "synthetic",
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  m.rpc.mockResolvedValue({ data: true, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["diagnosis", "consultation"])(
  "%s uses the real shared guard before provider and settles usage",
  async (path) => {
    m.parse.mockImplementation(async () => {
      expect(m.rpc.mock.calls.map((c) => c[0])).toEqual([
        "reserve_production_ai",
        "dispatch_production_ai",
      ]);
      return {
        model: "gpt-6-luna",
        service_tier: "default",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 0 },
        },
        output_parsed:
          path === "diagnosis" ? { ok: true } : { safety: false, answer: "" },
      };
    });
    if (path === "diagnosis")
      await runAI(
        "fixture",
        "classify",
        "synthetic",
        z.object({ ok: z.boolean() }),
        {},
        { fresh: true },
      );
    else await checkChatSafety({ user: "fixture", plan: "free" }, "synthetic");
    expect(m.rpc.mock.calls.map((c) => c[0])).toEqual([
      "reserve_production_ai",
      "dispatch_production_ai",
      "finish_production_ai",
    ]);
    expect(m.parse.mock.calls[0][0]).toMatchObject({
      store: false,
      service_tier: "default",
      truncation: "disabled",
    });
    expect(m.construct.mock.calls[0][0]).toMatchObject({
      baseURL: "https://api.openai.com/v1",
      project: "proj_synthetic",
      organization: null,
      maxRetries: 0,
    });
    expect(m.insert.mock.calls[0][0]).toMatchObject({ is_test: false });
    expect(m.rpc.mock.calls[0][1].p_id).toBe(
      path === "diagnosis" ? m.insert.mock.calls[0][0].id : "fixture-call",
    );
  },
);
it("production never repeats an unknown provider call even when a caller requests three attempts", async () => {
  m.parse.mockRejectedValue(
    Object.assign(new Error("synthetic provider detail"), { status: 503 }),
  );
  await expect(
    runAI(
      "fixture",
      "classify",
      "synthetic",
      z.object({ ok: z.boolean() }),
      {},
      { fresh: true, attempts: 3 },
    ),
  ).rejects.toThrow("Production operation unavailable");
  expect(m.parse).toHaveBeenCalledTimes(1);
  expect(m.rpc.mock.calls.map((c) => c[0])).toEqual([
    "reserve_production_ai",
    "dispatch_production_ai",
    "stop_unknown_production_ai",
  ]);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    "provider detail",
  );
});
it.each(["diagnosis", "consultation"])(
  "%s cannot send when shared reservation is denied",
  async (path) => {
    m.rpc.mockResolvedValue({ data: false, error: null });
    const p =
      path === "diagnosis"
        ? runAI(
            "fixture",
            "classify",
            "synthetic",
            z.object({ ok: z.boolean() }),
            {},
            { fresh: true },
          )
        : checkChatSafety({ user: "fixture", plan: "free" }, "synthetic");
    await expect(p).rejects.toThrow("Production operation unavailable");
    expect(m.parse).not.toHaveBeenCalled();
  },
);
