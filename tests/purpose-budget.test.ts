import { expect, it } from "vitest";
import { purposeBudget } from "../scripts/purpose-evaluation/budget.mjs";
const prior = { calls: 10, reservedNano: 1200000000, elapsedMillis: 5000 };
const request = {
  model: "gpt-6-luna",
  store: false,
  input: [{ role: "user", content: "合成" }],
  max_output_tokens: 100,
};
const result = {
  status: "completed",
  model: "gpt-6-luna",
  service_tier: "default",
  usage: { input_tokens: 100, output_tokens: 50 },
};
it("reserves durably before dispatch and keeps prior reservations", async () => {
  const journal: unknown[] = [];
  const b = purposeBudget({
    prior,
    checkpoint: async (s: unknown) => {
      journal.push(s);
    },
  });
  await b.call(
    "case-stage",
    request,
    async (p: Record<string, unknown>, o: Record<string, unknown>) => {
      expect(journal).toHaveLength(1);
      expect(p.truncation).toBe("disabled");
      expect(o.maxRetries).toBe(0);
      return result;
    },
  );
  expect(b.summary().cumulativeCalls).toBe(11);
  expect(b.summary().cumulativeReservedNano).toBeGreaterThan(
    prior.reservedNano,
  );
  await expect(
    b.call("case-stage", request, async () => result),
  ).rejects.toThrow();
});
it("unknown result stops and retains the full reservation", async () => {
  const b = purposeBudget({ prior, checkpoint: async () => {} });
  await expect(
    b.call("x", request, async () => {
      throw Error("private response");
    }),
  ).rejects.toThrow("PURPOSE_STOP");
  expect(b.summary().reservedNano).toBe(1050000 * 550 + 100 * 825);
  expect(b.summary().unknown).toBe(1);
  await expect(b.call("y", request, async () => result)).rejects.toThrow();
});
it("deadline, prior budget, concurrent work and checkpoint failure fail closed", async () => {
  let now = 1;
  const b = purposeBudget({
    prior,
    checkpoint: async () => {},
    now: () => now,
  });
  now = 1200002;
  await expect(b.call("x", request, async () => result)).rejects.toThrow();
  const c = purposeBudget({
    prior: { ...prior, reservedNano: 11999999999 },
    checkpoint: async () => {},
  });
  await expect(c.call("x", request, async () => result)).rejects.toThrow(
    "PURPOSE_BUDGET",
  );
  let sent = false;
  const d = purposeBudget({
    prior,
    checkpoint: async () => {
      throw Error();
    },
  });
  await expect(
    d.call("x", request, async () => {
      sent = true;
      return result;
    }),
  ).rejects.toThrow();
  expect(sent).toBe(false);
  expect(d.summary().unknown).toBe(1);
});
it("rejects image/tools/model/tier expansion", async () => {
  for (const extra of [
    { tools: [] },
    { model: "other" },
    { service_tier: "priority" },
    { input: [{ role: "user", content: [] }] },
  ]) {
    const b = purposeBudget({ prior, checkpoint: async () => {} });
    await expect(
      b.call("x", { ...request, ...extra }, async () => result),
    ).rejects.toThrow("PURPOSE_REQUEST");
  }
});
