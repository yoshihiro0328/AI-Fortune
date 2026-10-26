import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import {
  evaluationProvider,
  createEvaluationLedger,
} from "../scripts/phase6/ai-evaluation/provider.mjs";
const params = () => ({
  model: "gpt-6-luna",
  store: false,
  input: [{ role: "user", content: "合成の評価入力" }],
  text: { format: zodTextFormat(z.object({ ok: z.boolean() }), "test") },
  max_output_tokens: 2400,
});
const result = () => ({
  id: "resp_fixture",
  model: "gpt-6-luna",
  service_tier: "default",
  usage: { input_tokens: 30, output_tokens: 10 },
  output: [
    {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }],
    },
  ],
});
describe("credential-free actual SDK evaluation gate", () => {
  it("counts the exact schema/input then parses through SDK with fixed model/tier and no retry", async () => {
    const requests: { path: string; body: Record<string, unknown> }[] = [];
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        requests.push({ path, body: JSON.parse(String(init?.body)) });
        return Response.json(
          path.endsWith("input_tokens")
            ? { object: "response.input_tokens", input_tokens: 30 }
            : result(),
        );
      },
    );
    const client = new OpenAI({
      apiKey: "synthetic-not-a-key",
      fetch: fetcher,
      maxRetries: 0,
    });
    const gate = evaluationProvider(client, {
      deadline: Date.now() + 60000,
      checkpoint: async () => undefined,
    });
    expect(
      (await gate.parse("consultation", 1, params())).output_parsed,
    ).toEqual({ ok: true });
    expect(requests.map((r) => r.path)).toEqual([
      "/v1/responses/input_tokens",
      "/v1/responses",
    ]);
    for (const key of ["model", "input", "text"])
      expect(requests[0].body[key]).toEqual(requests[1].body[key]);
    expect(requests[1].body.service_tier).toBe("default");
    expect(gate.summary()).toMatchObject({ calls: 1, stopped: false });
  });
  it("unknown result is redacted, reserved and permanently stops further generation", async () => {
    const parse = vi
      .fn()
      .mockRejectedValue(new Error("synthetic-sensitive-content"));
    const gate = evaluationProvider(
      {
        responses: {
          inputTokens: { count: async () => ({ input_tokens: 1 }) },
          parse,
        },
      },
      { deadline: Date.now() + 60000, checkpoint: async () => undefined },
    );
    await expect(gate.parse("consultation", 1, params())).rejects.toThrow(
      /^EVAL_PROVIDER_STOPPED$/,
    );
    await expect(gate.parse("consultation", 2, params())).rejects.toThrow(
      "ALLOWANCE",
    );
    expect(parse).toHaveBeenCalledTimes(1);
    expect(gate.summary().reservedUSD).toBeGreaterThan(0);
  });
  it("oversized counted input never reaches generation", async () => {
    const parse = vi.fn();
    const gate = evaluationProvider(
      {
        responses: {
          inputTokens: { count: async () => ({ input_tokens: 12001 }) },
          parse,
        },
      },
      { deadline: Date.now() + 60000, checkpoint: async () => undefined },
    );
    await expect(gate.parse("consultation", 1, params())).rejects.toThrow(
      "STOPPED",
    );
    expect(parse).not.toHaveBeenCalled();
  });
  it("per-case allowance includes edits and attempts; wrong scope/model/tools are blocked", async () => {
    const parse = vi.fn().mockImplementation(async () => result());
    const gate = evaluationProvider(
      {
        responses: {
          inputTokens: { count: async () => ({ input_tokens: 30 }) },
          parse,
        },
      },
      { deadline: Date.now() + 60000, checkpoint: async () => undefined },
    );
    for (let i = 0; i < 3; i++) await gate.parse("consultation", 1, params());
    await expect(gate.parse("consultation", 1, params())).rejects.toThrow(
      "ALLOWANCE",
    );
    await expect(gate.parse("consultation", 15, params())).rejects.toThrow(
      "ALLOWANCE",
    );
    await expect(
      gate.parse("diagnosis", 1, { ...params(), model: "unapproved" }),
    ).rejects.toThrow("REQUEST");
    await expect(
      gate.parse("diagnosis", 1, { ...params(), tools: [] }),
    ).rejects.toThrow("REQUEST");
    expect(parse).toHaveBeenCalledTimes(3);
  });
  it("unexpected response tier or missing usage consumes the reservation and stops", async () => {
    for (const response of [
      { ...result(), service_tier: "priority" },
      { ...result(), usage: null },
    ]) {
      const gate = evaluationProvider(
        {
          responses: {
            inputTokens: { count: async () => ({ input_tokens: 30 }) },
            parse: async () => response,
          },
        },
        { deadline: Date.now() + 60000, checkpoint: async () => undefined },
      );
      await expect(gate.parse("diagnosis", 1, params())).rejects.toThrow(
        "STOPPED",
      );
      expect(gate.summary().calls).toBe(1);
    }
  });
});

it("persists reservation before dispatch and refuses to overwrite a previous journal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ai-budget-"));
  const path = join(dir, "reservation.jsonl");
  const journal = await createEvaluationLedger(path);
  try {
    const count = vi.fn(async () => {
      expect(JSON.parse((await readFile(path, "utf8")).trim()).calls).toBe(1);
      return { input_tokens: 30 };
    });
    const gate = evaluationProvider(
      { responses: { inputTokens: { count }, parse: async () => result() } },
      { deadline: Date.now() + 60000, checkpoint: journal.checkpoint },
    );
    await gate.parse("consultation", 1, params());
    await expect(createEvaluationLedger(path)).rejects.toMatchObject({
      code: "EEXIST",
    });
    const denied = evaluationProvider(
      { responses: { inputTokens: { count } } },
      {
        deadline: Date.now() + 60000,
        checkpoint: async () => {
          throw Error("synthetic disk failure");
        },
      },
    );
    await expect(denied.parse("consultation", 2, params())).rejects.toThrow(
      "STOPPED",
    );
    expect(count).toHaveBeenCalledTimes(1);
  } finally {
    await journal.close();
    await rm(dir, { recursive: true, force: true });
  }
});
