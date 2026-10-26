import { it, expect, vi } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  recoverBudget,
  recoveryPlan,
} from "../scripts/phase6/ai-evaluation/recovery.mjs";
import { evaluationProvider } from "../scripts/phase6/ai-evaluation/provider.mjs";

function fixtureLedger() {
  const allocations: [string, number][] = [
    ...Array.from({ length: 14 }, (_, i): [string, number] => [
      `consultation:${i + 1}`,
      1,
    ]),
    ["diagnosis:1", 11],
    ["diagnosis:2", 12],
    ["diagnosis:3", 13],
    ["diagnosis:4", 9],
    ["diagnosis:5", 8],
  ];
  const cases: Record<string, number> = {},
    rows: object[] = [];
  let calls = 0;
  for (const [key, count] of allocations)
    for (let i = 0; i < count; i++) {
      cases[key] = (cases[key] ?? 0) + 1;
      calls++;
      rows.push({
        phase: "reserved",
        calls,
        cases: { ...cases },
        reservedUSD: calls === 67 ? 0.6605566 : 0.6,
      });
      if (calls < 67)
        rows.push({
          phase: "usage_observed",
          calls,
          completed: calls,
          inputTokens: calls * 100,
          outputTokens: calls * 10,
          reservedUSD: (0.0760441 * calls) / 66,
        });
    }
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
it("carries unknown cost and per-case counts into a bounded new request, without settling the unknown", async () => {
  const prior = recoverBudget(fixtureLedger());
  expect(prior).toMatchObject({
    calls: 67,
    completed: 66,
    unknownCalls: 1,
    reservedNano: 660556600,
  });
  const parse = vi.fn(async () => ({
    status: "completed",
    model: "gpt-6-luna",
    service_tier: "default",
    usage: { input_tokens: 100, output_tokens: 10 },
  }));
  const gate = evaluationProvider(
    { responses: { parse } },
    { prior, deadline: Date.now() + 60000, checkpoint: async () => {} },
  );
  await gate.parse("diagnosis", 4, {
    model: "gpt-6-luna",
    store: false,
    input: [{ role: "user", content: "new reviewed repair input" }],
    max_output_tokens: 2400,
  });
  expect(gate.summary()).toMatchObject({
    calls: 68,
    completed: 67,
    unknownCalls: 1,
  });
  expect(gate.summary().reservedUSD).toBeGreaterThan(0.6605566);
  expect(() =>
    recoverBudget(fixtureLedger().replace('"calls":67', '"calls":68')),
  ).toThrow();
  expect(() =>
    recoverBudget(
      fixtureLedger() +
        '{ "phase":"usage_observed", "calls":67, "completed":65,"reservedUSD":0 }',
    ),
  ).toThrow();
});

it("synthetic continuation preserves completed files, repairs only the saved draft and completes the remaining cases", async () => {
  const root = await mkdtemp(join(tmpdir(), "ai-recovery-"));
  const baseline = join(root, "baseline"),
    continuation = join(root, "continuation");
  await mkdir(baseline, { mode: 0o700 });
  await mkdir(continuation, { mode: 0o700 });
  const run = (dir: string, recovery?: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--config",
          "scripts/phase6/ai-evaluation/evaluation.config.ts",
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            NODE_ENV: "test",
            AI_EVALUATION_MODE: "synthetic",
            AI_EVALUATION_DIRECTORY: dir,
            ...(recovery ? { AI_EVALUATION_RECOVERY_DIRECTORY: recovery } : {}),
          },
          stdio: "ignore",
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(Error("SYNTHETIC_RUN_FAILED")),
      );
    });
  try {
    await run(baseline);
    const original = await readFile(join(baseline, "diagnosis-4.json"), "utf8");
    await writeFile(join(baseline, "budget.jsonl"), fixtureLedger());
    for (const [name, data] of Object.entries({
      "session-status.json": {
        phase: "closed",
        credentialDeleted: true,
        receiverClosed: true,
      },
      "quality-stop.json": {
        reason: "unsupported_past_event",
        case: "diagnosis:4",
      },
      "owner-key-revocation.json": { ownerReportedRevoked: true },
    }))
      await writeFile(join(baseline, name), JSON.stringify(data));
    const plan = recoveryPlan(baseline);
    expect(plan.remainingMillis).toBeLessThan(1200000);
    await writeFile(
      join(continuation, "execution-start.json"),
      JSON.stringify({ startedAt: Date.now() }),
    );
    await run(continuation, baseline);
    const result = JSON.parse(
      await readFile(join(continuation, "result.json"), "utf8"),
    );
    expect(result.terminal).toBe("completed");
    expect(
      result.cases.map((r: { caseNumber: number }) => r.caseNumber),
    ).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(result.budget.unknownCalls).toBe(1);
    expect(result.budget.calls).toBeGreaterThan(67);
    expect(result.budget.reservedUSD).toBeGreaterThan(0.6605566);
    expect(await readFile(join(baseline, "diagnosis-4.json"), "utf8")).toBe(
      original,
    );
    await expect(
      readFile(join(continuation, "consultation-1.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
