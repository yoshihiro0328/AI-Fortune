import { expect, it } from "vitest";
import {
  continuationPlan,
  digest,
} from "../scripts/purpose-evaluation/continuation.mjs";
import { purposeBudget } from "../scripts/purpose-evaluation/budget.mjs";
const prior = { calls: 10, reservedNano: 100000000, elapsedMillis: 5000 };
const cases = [
  { id: "clear-reply", message: "合成A" },
  { id: "waiting-reply", message: "合成B" },
  { id: "danger-reply", message: "合成C" },
];
const base = {
  calls: 2,
  completed: 2,
  unknown: 0,
  inputTokens: 100,
  outputTokens: 50,
  reservedNano: 96300,
  elapsedMillis: 15000,
  priorPreserved: prior,
};
const journal = [
  { phase: "reserved", id: "clear-reply-0" },
  { phase: "observed", id: "clear-reply-0" },
  { phase: "reserved", id: "clear-reply-1" },
  { ...base, phase: "observed", id: "clear-reply-1" },
]
  .map((x) => JSON.stringify(x))
  .join("\n");
const fixture = () => ({
  journal,
  expectedHash: digest(journal),
  prior,
  elapsedMillis: 11000,
  firstReceiptAt: 1000,
  now: 12000,
  cases,
  results: { "clear-reply": { input: cases[0] } },
  review: { "clear-reply": "fail" },
  safetyStages: {
    "clear-reply": {
      usageVerified: true,
      hash: "request-hash",
      result: { safety: false },
      usage: { input_tokens: 20, output_tokens: 5 },
    },
  },
});
it("continues only unfinished cases and an explicitly failed completed case; confirmed safety is reused", () => {
  const p = continuationPlan(fixture());
  expect(p.selected.map((x) => x.evaluationId)).toEqual([
    "clear-reply-correction1",
    "waiting-reply",
    "danger-reply",
  ]);
  expect(p.reuse["clear-reply-correction1-0"].result).toEqual({
    safety: false,
  });
  const f = fixture();
  f.review["clear-reply"] = "pass";
  expect(continuationPlan(f).selected).toHaveLength(2);
});
it("rejects altered journals, unknown stages, missing reviews, altered cases and time reset", () => {
  for (const patch of [
    { expectedHash: "changed" },
    { elapsedMillis: 0 },
    { review: {} },
    { results: { "clear-reply": { input: { id: "changed" } } } },
  ])
    expect(() => continuationPlan({ ...fixture(), ...patch })).toThrow();
  const j =
    journal +
    "\n" +
    JSON.stringify({
      ...base,
      phase: "reserved",
      id: "waiting-reply-0",
      unknown: 1,
    });
  expect(() =>
    continuationPlan({ ...fixture(), journal: j, expectedHash: digest(j) }),
  ).toThrow("HISTORY_UNCONFIRMED");
});
it("continuation cannot reset scoped request, time or cost limits; prior unknown reservations stay charged", async () => {
  const request = {
    model: "gpt-6-luna",
    store: false,
    input: [{ role: "user", content: "合成" }],
    max_output_tokens: 100,
  };
  const carry = {
    calls: 53,
    completed: 53,
    reservedNano: 200000,
    inputTokens: 1000,
    outputTokens: 500,
    elapsedMillis: 1199000,
  };
  let now = 10;
  const b = purposeBudget({
    prior,
    carried: carry,
    now: () => now,
    checkpoint: async () => {},
  });
  await b.call("new", request, async () => ({
    status: "completed",
    model: "gpt-6-luna",
    service_tier: "default",
    usage: { input_tokens: 10, output_tokens: 5 },
  }));
  expect(b.summary().calls).toBe(54);
  expect(b.summary().cumulativeCalls).toBe(64);
  expect(b.summary().priorPreserved).toEqual(prior);
  await expect(b.call("extra", request, async () => {})).rejects.toThrow();
  const timed = purposeBudget({
    prior,
    carried: carry,
    now: () => now,
    checkpoint: async () => {},
  });
  now += 1001;
  await expect(timed.call("late", request, async () => {})).rejects.toThrow();
  const cost = purposeBudget({
    prior,
    carried: { ...carry, calls: 2, completed: 2, reservedNano: 2900000000 },
    checkpoint: async () => {},
  });
  await expect(cost.call("cost", request, async () => {})).rejects.toThrow(
    "PURPOSE_BUDGET",
  );
});

it("preparation and CI waiting cannot reset the first-receipt deadline", () => {
  expect(() => continuationPlan({ ...fixture(), now: 1201000 })).toThrow(
    "RECEIPT_DEADLINE",
  );
  expect(
    continuationPlan({ ...fixture(), now: 901000 }).carried.elapsedMillis,
  ).toBe(900000);
});
