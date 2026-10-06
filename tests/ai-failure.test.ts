import { it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
const { parse, insert } = vi.hoisted(() => ({
  parse: vi.fn(),
  insert: vi.fn().mockResolvedValue({ error: null }),
}));
vi.mock("openai", () => ({
  default: class {
    responses = { parse };
  },
}));
vi.mock("../src/lib/supabase/admin", () => ({
  db: () => ({ from: () => ({ insert }) }),
  checked: (r: { error: unknown }) => {
    if (r.error) throw r.error;
  },
}));
import { runAI } from "../src/lib/ai/run";
beforeEach(() => {
  parse.mockReset();
  insert.mockClear();
  process.env.OPENAI_MODEL = "fixture";
  process.env.OPENAI_API_KEY = "fixture";
});
it("AI timeout retries twice and records failure without a result", async () => {
  parse.mockRejectedValue(new Error("timeout"));
  await expect(
    runAI("fixture", "classify", "prompt", z.object({ ok: z.boolean() }), {}),
  ).rejects.toThrow("timeout");
  expect(parse).toHaveBeenCalledTimes(2);
  expect(insert).toHaveBeenCalledTimes(2);
  expect(insert.mock.calls.every((c) => c[0].success === false)).toBe(true);
});
it("invalid AI output is never accepted", async () => {
  parse.mockResolvedValue({ output_parsed: { ok: "yes" } });
  await expect(
    runAI("fixture", "classify", "prompt", z.object({ ok: z.boolean() }), {}),
  ).rejects.toThrow();
  expect(parse).toHaveBeenCalledTimes(2);
});
