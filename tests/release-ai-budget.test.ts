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
  status: "completed",
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
  it("reserves official context ceiling before one SDK generation without count API", async () => {
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
    expect(requests.map((r) => r.path)).toEqual(["/v1/responses"]);
    expect(requests[0].body.service_tier).toBe("default");
    expect(requests[0].body.truncation).toBe("disabled");
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
  it("unexpected observed input retains full context reservation and stops", async () => {
    const parse = vi.fn(async () => ({
      ...result(),
      usage: { input_tokens: 12001, output_tokens: 10 },
    }));
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
    expect(parse).toHaveBeenCalledTimes(1);
    expect(gate.summary().reservedUSD).toBe(0.57948);
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
    const parse = vi.fn(async () => {
      expect(JSON.parse((await readFile(path, "utf8")).trim()).calls).toBe(1);
      return result();
    });
    const gate = evaluationProvider(
      { responses: { parse } },
      { deadline: Date.now() + 60000, checkpoint: journal.checkpoint },
    );
    await gate.parse("consultation", 1, params());
    await expect(createEvaluationLedger(path)).rejects.toMatchObject({
      code: "EEXIST",
    });
    const denied = evaluationProvider(
      { responses: { parse } },
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
    expect(parse).toHaveBeenCalledTimes(1);
  } finally {
    await journal.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("all 842 worst-case verified calls fit while each dispatch holds the full context risk", async () => {
  let cap = { input: 12000, output: 2400 };
  let peak = 0;
  const gate = evaluationProvider(
    {
      responses: {
        parse: async () => ({
          ...result(),
          usage: { input_tokens: cap.input, output_tokens: cap.output },
        }),
      },
    },
    {
      deadline: Date.now() + 1200000,
      checkpoint: async (summary: object) => {
        const s = summary as { reservedUSD: number };
        peak = Math.max(peak, s.reservedUSD);
        expect(s.reservedUSD).toBeLessThanOrEqual(12);
      },
    },
  );
  for (const [group, cases, attempts, input, output] of [
    ["consultation", 14, 3, 12000, 2400],
    ["diagnosis", 10, 80, 30000, 8500],
  ] as const) {
    cap = { input, output };
    for (let c = 1; c <= cases; c++)
      for (let n = 0; n < attempts; n++)
        await gate.parse(group, c, { ...params(), max_output_tokens: output });
  }
  expect(gate.summary()).toMatchObject({
    calls: 842,
    completed: 842,
    reservedUSD: 10.53404,
  });
  expect(peak).toBeGreaterThan(11);
  await expect(gate.parse("diagnosis", 10, params())).rejects.toThrow(
    "ALLOWANCE",
  );
});

it("a journal failure after response does not release its hold; concurrent call is blocked", async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let checkpoints = 0;
  const gate = evaluationProvider(
    {
      responses: {
        parse: async () => {
          await wait;
          return result();
        },
      },
    },
    {
      deadline: Date.now() + 60000,
      checkpoint: async () => {
        if (++checkpoints === 2) throw Error("disk");
      },
    },
  );
  const first = gate.parse("consultation", 1, params());
  await expect(gate.parse("consultation", 2, params())).rejects.toThrow(
    "ALLOWANCE",
  );
  release();
  await expect(first).rejects.toThrow("STOPPED");
  expect(gate.summary().reservedUSD).toBe(0.57948);
  expect(gate.summary()).toMatchObject({
    completed: 0,
    unknownCalls: 1,
    inputTokens: 0,
    outputTokens: 0,
    stopDiagnostic: { reason: "settlement_persistence_failed" },
  });
});

describe("nonsecret evaluation stop diagnostics", () => {
  it.each(["RateLimitError", "sensitive-error-name"])(
    "records only allowlisted metadata for %s, never provider payloads",
    async (name) => {
      const rows: object[] = [];
      const parse = vi
        .fn()
        .mockRejectedValue(
          Object.assign(
            new Error(
              "sensitive-message https://example.invalid/?secret=synthetic",
            ),
            {
              name,
              status: 429,
              headers: { authorization: "sensitive-header" },
              error: { message: "sensitive-body" },
              request_id: "sensitive-id",
            },
          ),
        );
      const gate = evaluationProvider(
        { responses: { parse } },
        {
          deadline: Date.now() + 60000,
          checkpoint: async (row: object) => {
            rows.push(row);
          },
        },
      );
      const request = params();
      request.text.format.name = "sensitive-schema-name";
      await expect(gate.parse("diagnosis", 6, request)).rejects.toThrow(
        /^EVAL_PROVIDER_STOPPED$/,
      );
      expect(gate.summary().stopDiagnostic).toEqual({
        group: "diagnosis",
        caseNumber: 6,
        stage: "other",
        reason: "provider_exception",
        errorClass: name === "RateLimitError" ? name : "other",
        httpStatus: 429,
        response: null,
      });
      expect(rows.map((row) => (row as { phase: string }).phase)).toEqual([
        "reserved",
        "stopped",
      ]);
      expect(JSON.stringify({ rows, summary: gate.summary() })).not.toMatch(
        /sensitive|https:\/\/|secret=/,
      );
      await expect(gate.parse("diagnosis", 6, request)).rejects.toThrow(
        "ALLOWANCE",
      );
      expect(parse).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
      "response_not_completed",
    ],
    [
      { usage: { input_tokens: 30001, output_tokens: 10 } },
      "usage_invalid_or_over_cap",
    ],
    [{ model: "sensitive-model" }, "model_mismatch"],
    [{ service_tier: "sensitive-tier" }, "tier_mismatch"],
    [
      {
        status: "sensitive-status",
        incomplete_details: { reason: "sensitive-reason" },
      },
      "response_not_completed",
    ],
  ])(
    "distinguishes invalid responses without exposing text (%j)",
    async (override, reason) => {
      const rows: object[] = [];
      const gate = evaluationProvider(
        {
          responses: {
            parse: async () => ({
              ...result(),
              ...override,
              output_text: "sensitive-output",
              error: { message: "sensitive-error" },
            }),
          },
        },
        {
          deadline: Date.now() + 60000,
          checkpoint: async (row: object) => {
            rows.push(row);
          },
        },
      );
      const request = params();
      request.text.format.name = "paid_report_review_1";
      await expect(gate.parse("diagnosis", 6, request)).rejects.toThrow(
        "STOPPED",
      );
      expect(gate.summary()).toMatchObject({
        calls: 1,
        completed: 0,
        unknownCalls: 1,
        reservedUSD: 0.57948,
        stopDiagnostic: { reason, stage: "paid_report_review_1" },
      });
      expect(JSON.stringify({ rows, summary: gate.summary() })).not.toContain(
        "sensitive",
      );
    },
  );

  it("stops before dispatch when reservation cannot be saved, without leaking disk error", async () => {
    const parse = vi.fn();
    const gate = evaluationProvider(
      { responses: { parse } },
      {
        deadline: Date.now() + 60000,
        checkpoint: async () => {
          throw Error("sensitive-local-path");
        },
      },
    );
    await expect(gate.parse("diagnosis", 6, params())).rejects.toThrow(
      /^EVAL_PROVIDER_STOPPED$/,
    );
    expect(parse).not.toHaveBeenCalled();
    expect(gate.summary()).toMatchObject({
      reservedUSD: 0.57948,
      completed: 0,
      unknownCalls: 1,
      stopDiagnostic: { reason: "reservation_persistence_failed" },
    });
    expect(JSON.stringify(gate.summary())).not.toContain("sensitive");
  });
});
