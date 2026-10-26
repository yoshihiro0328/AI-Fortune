import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// One explicitly reviewed quality-stop continuation. Never resets the approval.
export function recoverBudget(text) {
  const rows = text
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  let calls = 0,
    pending = false,
    last,
    cases = {},
    observed = {
      inputTokens: 0,
      outputTokens: 0,
      completed: 0,
    };
  for (const row of rows) {
    if (
      typeof row.reservedUSD !== "number" ||
      !Number.isFinite(row.reservedUSD) ||
      !Number.isSafeInteger(Math.round(row.reservedUSD * 1e9)) ||
      row.reservedUSD < 0 ||
      row.reservedUSD > 12
    )
      throw Error("RECOVERY_BUDGET_INVALID");
    if (row.phase === "reserved") {
      if (pending || row.calls !== calls + 1)
        throw Error("RECOVERY_SEQUENCE_INVALID");
      calls = row.calls;
      pending = true;
      cases = row.cases;
      if (Object.values(cases).reduce((a, b) => a + b, 0) !== calls)
        throw Error("RECOVERY_CASE_COUNT_INVALID");
      for (const [key, count] of Object.entries(cases)) {
        const [group, n] = key.split(":");
        const consultation = group === "consultation";
        if (
          (!consultation && group !== "diagnosis") ||
          !Number.isInteger(+n) ||
          +n < 1 ||
          +n > (consultation ? 14 : 10) ||
          !Number.isInteger(count) ||
          count < 1 ||
          count > (consultation ? 3 : 80)
        )
          throw Error("RECOVERY_CASE_COUNT_INVALID");
      }
    } else if (row.phase === "usage_observed") {
      if (
        !pending ||
        row.calls !== calls ||
        row.completed !== observed.completed + 1 ||
        ![row.inputTokens, row.outputTokens].every(Number.isSafeInteger) ||
        row.inputTokens < observed.inputTokens ||
        row.outputTokens < observed.outputTokens
      )
        throw Error("RECOVERY_USAGE_INVALID");
      observed = {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        completed: row.completed,
      };
      pending = false;
    } else throw Error("RECOVERY_PHASE_INVALID");
    last = row;
  }
  if (!last || calls > 842) throw Error("RECOVERY_EMPTY_OR_EXHAUSTED");
  return {
    calls,
    reservedNano: Math.round(last.reservedUSD * 1e9),
    cases,
    ...observed,
    unknownCalls: calls - observed.completed,
  };
}

export function recoveryPlan(directory) {
  const read = (n) =>
    JSON.parse(fs.readFileSync(path.join(directory, n), "utf8"));
  const status = read("session-status.json"),
    stop = read("quality-stop.json");
  if (
    status.phase !== "closed" ||
    !status.credentialDeleted ||
    !status.receiverClosed ||
    stop.reason !== "unsupported_past_event" ||
    stop.case !== "diagnosis:4" ||
    !read("owner-key-revocation.json").ownerReportedRevoked ||
    fs.existsSync(path.join(directory, "openai-key.json"))
  )
    throw Error("RECOVERY_NOT_CLOSED");
  const ledgerPath = path.join(directory, "budget.jsonl");
  const text = fs.readFileSync(ledgerPath, "utf8");
  const prior = recoverBudget(text);
  // This continuation is scoped to the observed run, not a generic replay switch.
  if (
    prior.calls !== 67 ||
    prior.completed !== 66 ||
    prior.unknownCalls !== 1 ||
    prior.cases["diagnosis:5"] !== 8 ||
    prior.reservedNano !== 660556600
  )
    throw Error("RECOVERY_BASELINE_MISMATCH");
  for (const [group, count] of [
    ["consultation", 14],
    ["diagnosis", 4],
  ])
    for (let n = 1; n <= count; n++)
      if (read(`case-${group}-${n}-status.json`).status !== "completed")
        throw Error("RECOVERY_SUCCESS_EVIDENCE_MISSING");
  // macOS birthtime is the original run start; never use the most recent write.
  const start = fs.statSync(ledgerPath).birthtimeMs;
  const end = fs.statSync(path.join(directory, "session-status.json")).mtimeMs;
  const remainingMillis = Math.floor(1200000 - (end - start) - 10000);
  if (!(
    start > 0 &&
    end >= start &&
    remainingMillis > 0 &&
    remainingMillis < 1200000
  ))
    throw Error("RECOVERY_TIME_EXHAUSTED");
  return {
    prior,
    remainingMillis,
    ledgerSHA256: createHash("sha256").update(text).digest("hex"),
  };
}
