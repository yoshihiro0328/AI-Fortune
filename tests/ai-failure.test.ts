import { it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  cached: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    responses = { parse: mocks.parse };
  },
}));
vi.mock("../src/lib/supabase/admin", () => ({
  db: () => ({
    from: () => ({
      insert: mocks.insert,
      update: mocks.update,
      select: () => {
        const q = {
          eq: () => q,
          order: () => q,
          limit: () => q,
          maybeSingle: mocks.cached,
        };
        return q;
      },
    }),
  }),
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
import { runAI } from "../src/lib/ai/run";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cached.mockResolvedValue({ data: null, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_API_KEY = "fixture";
});
it("timeout saves a failed generation without publishing or unbounded retry", async () => {
  mocks.parse.mockRejectedValue(new Error("timeout"));
  await expect(
    runAI("fixture", "classify", "prompt", z.object({ ok: z.boolean() }), {}),
  ).rejects.toThrow("timeout");
  expect(mocks.parse).toHaveBeenCalledTimes(1);
  expect(mocks.insert).toHaveBeenCalledTimes(1);
  expect(mocks.update.mock.calls[0][0].success).toBe(false);
});
it("invalid AI output is never accepted", async () => {
  mocks.parse.mockResolvedValue({ output_parsed: { ok: "yes" } });
  await expect(
    runAI("fixture", "classify", "prompt", z.object({ ok: z.boolean() }), {}),
  ).rejects.toThrow();
  expect(mocks.update.mock.calls[0][0].success).toBe(false);
});
it("successful saved stage resumes without another provider call", async () => {
  mocks.cached.mockResolvedValue({
    data: { output_json: { ok: true } },
    error: null,
  });
  expect(
    await runAI(
      "fixture",
      "classify",
      "prompt",
      z.object({ ok: z.boolean() }),
      {},
    ),
  ).toEqual({ ok: true });
  expect(mocks.parse).not.toHaveBeenCalled();
});
it("expired budget never starts another provider call", async () => {
  await expect(
    runAI(
      "fixture",
      "classify",
      "prompt",
      z.object({ ok: z.boolean() }),
      {},
      { deadline: Date.now() - 1 },
    ),
  ).rejects.toThrow("budget");
  expect(mocks.parse).not.toHaveBeenCalled();
});
it("transient provider overload retries once, without retrying indefinitely", async () => {
  vi.useFakeTimers();
  const overloaded = Object.assign(new Error("overloaded"), { status: 503 });
  mocks.parse
    .mockRejectedValueOnce(overloaded)
    .mockResolvedValueOnce({ output_parsed: { ok: true } });
  const pending = runAI(
    "fixture",
    "classify",
    "prompt",
    z.object({ ok: z.boolean() }),
    {},
  );
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toEqual({ ok: true });
  expect(mocks.parse).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
it("provider overload is still bounded when both attempts fail", async () => {
  vi.useFakeTimers();
  mocks.parse.mockRejectedValue(
    Object.assign(new Error("overloaded"), { status: 503 }),
  );
  const pending = expect(
    runAI("fixture", "classify", "prompt", z.object({ ok: z.boolean() }), {}),
  ).rejects.toThrow("overloaded");
  await vi.runAllTimersAsync();
  await pending;
  expect(mocks.parse).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
