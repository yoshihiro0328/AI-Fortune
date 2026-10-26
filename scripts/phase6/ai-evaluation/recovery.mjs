import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// One explicitly reviewed quality-stop continuation. Never resets the approval.
export function recoverBudget(text, prior) {
  const rows = text
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  let calls = prior?.calls ?? 0,
    pending = false,
    last,
    cases = prior?.cases ?? {},
    observed = {
      inputTokens: prior?.inputTokens ?? 0,
      outputTokens: prior?.outputTokens ?? 0,
      completed: prior?.completed ?? 0,
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

// Owner-approved extra 20 minutes, scoped to the preserved Oct 26 records.
// Case 6 is withheld: its unknown review request and intermediate outputs
// cannot be recovered. This mode cannot silently repeat that case or 1–5.
export function extensionPlan(originalDirectory, continuationDirectory) {
  const original = recoveryPlan(originalDirectory);
  const read = (n) =>
    JSON.parse(fs.readFileSync(path.join(continuationDirectory, n), "utf8"));
  const status = read("session-status.json"),
    result = read("result.json");
  if (
    status.phase !== "closed" ||
    !status.credentialDeleted ||
    !status.receiverClosed ||
    !result.localDatabaseClosed ||
    !result.temporaryCredentialDeleted ||
    result.terminal !== "stopped" ||
    result.stopStage !== "diagnosis_6" ||
    !read("owner-key-revocation.json").ownerReportedRevoked ||
    fs.existsSync(path.join(continuationDirectory, "openai-key.json")) ||
    read("pilot-review.json").approved !== true ||
    read("review-5.json").approved !== true
  )
    throw Error("EXTENSION_BASELINE_NOT_CLOSED");
  const text = fs.readFileSync(
    path.join(continuationDirectory, "budget.jsonl"),
    "utf8",
  );
  const lines = text.trim().split("\n"),
    carried = JSON.parse(lines.shift());
  if (
    carried.phase !== "carried_forward" ||
    carried.ledgerSHA256 !== original.ledgerSHA256 ||
    JSON.stringify(carried.prior) !== JSON.stringify(original.prior)
  )
    throw Error("EXTENSION_HISTORY_MISMATCH");
  const prior = recoverBudget(lines.join("\n"), original.prior);
  if (
    prior.calls !== 97 ||
    prior.completed !== 95 ||
    prior.unknownCalls !== 2 ||
    prior.reservedNano !== 1288907125 ||
    prior.inputTokens !== 302543 ||
    prior.outputTokens !== 76746 ||
    prior.cases["diagnosis:6"] !== 11 ||
    [7, 8, 9, 10].some((n) => prior.cases[`diagnosis:${n}`]) ||
    ["calls", "completed", "unknownCalls", "inputTokens", "outputTokens"].some(
      (k) => result.budget[k] !== prior[k],
    ) ||
    Math.round(result.budget.reservedUSD * 1e9) !== prior.reservedNano
  )
    throw Error("EXTENSION_BUDGET_MISMATCH");
  const execution = read("execution-start.json");
  const end = fs.statSync(
    path.join(continuationDirectory, "session-status.json"),
  ).mtimeMs;
  const previousRemainingMillis = Math.floor(
    execution.remainingMillis - (end - execution.startedAt),
  );
  if (
    execution.remainingMillis !== carried.remainingMillis ||
    !Number.isSafeInteger(execution.startedAt) ||
    !Number.isFinite(previousRemainingMillis) ||
    previousRemainingMillis < 0 ||
    previousRemainingMillis > 1200000
  )
    throw Error("EXTENSION_TIME_MISMATCH");
  return {
    prior,
    remainingMillis: 1200000,
    timeHistory: {
      originalLimitMillis: 1200000,
      additionalApprovedMillis: 1200000,
      previousConsumedMillis: 1200000 - previousRemainingMillis,
      previousRemainingMillis,
      availableMillis: previousRemainingMillis + 1200000,
      allocationMillis: 1200000,
    },
    originalLedgerSHA256: original.ledgerSHA256,
    continuationLedgerSHA256: createHash("sha256").update(text).digest("hex"),
    allowedCases: [7, 8, 9, 10],
    blockedCases: [
      {
        caseNumber: 6,
        reason: "unknown_review_request_no_saved_intermediate_output",
      },
    ],
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

// Explicit new evaluations; never resolves or releases the old unknown calls.
export function revisionPlan(
  originalDirectory,
  continuationDirectory,
  extensionDirectory,
) {
  const previous = extensionPlan(originalDirectory, continuationDirectory);
  const read = (n) =>
    JSON.parse(fs.readFileSync(path.join(extensionDirectory, n), "utf8"));
  const state = read("final-nonsecret-state.json"),
    result = read("result.json"),
    status = read("session-status.json");
  const text = fs.readFileSync(
    path.join(extensionDirectory, "budget.jsonl"),
    "utf8",
  );
  const lines = text.trim().split("\n"),
    carried = JSON.parse(lines.shift());
  const hash = createHash("sha256").update(text).digest("hex");
  if (
    carried.phase !== "carried_forward" ||
    JSON.stringify(carried.prior) !== JSON.stringify(previous.prior) ||
    hash !== state.ledgerSHA256
  )
    throw Error("REVISION_HISTORY_MISMATCH");
  const prior = recoverBudget(lines.join("\n"), previous.prior);
  if (
    prior.calls !== 133 ||
    prior.completed !== 131 ||
    prior.unknownCalls !== 2 ||
    prior.reservedNano !== 1344001450 ||
    prior.inputTokens !== 429834 ||
    prior.outputTokens !== 113272 ||
    result.budget.calls !== prior.calls ||
    result.budget.reservedUSD !== prior.reservedNano / 1e9
  )
    throw Error("REVISION_BUDGET_MISMATCH");
  if (
    status.phase !== "closed" ||
    !status.credentialDeleted ||
    !status.receiverClosed ||
    !result.localDatabaseClosed ||
    !result.temporaryCredentialDeleted ||
    state.ownerRevocation !== "reported_revoked_by_owner" ||
    fs.existsSync(path.join(extensionDirectory, "openai-key.json"))
  )
    throw Error("REVISION_NOT_CLOSED");
  if (
    state.cumulativeElapsedMillis !== 1780613 ||
    state.cumulativeLimitMillis !== 2400000
  )
    throw Error("REVISION_TIME_MISMATCH");
  return {
    prior,
    remainingMillis: 1200000,
    allowedCases: [6, 7],
    blockedCases: [],
    oldUnknownCalls: 2,
    extensionLedgerSHA256: hash,
    evaluationIds: {
      6: "diagnosis-6-revision-20261026",
      7: "diagnosis-7-revision-20261026",
    },
    timeHistory: {
      previousConsumedMillis: state.cumulativeElapsedMillis,
      previousLimitMillis: state.cumulativeLimitMillis,
      additionalApprovedMillis: 1200000,
      cumulativeLimitMillis: 3600000,
      allocationMillis: 1200000,
      previousRemainingMillis: 619387,
    },
  };
}
