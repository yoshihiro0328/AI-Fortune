import { aiEvaluation } from "../subscription-runtime/remaining-plan.mjs";
import { open } from "node:fs/promises";

function safeStage(name) {
  return typeof name === "string" &&
    /^(?:chat(?:_safety)?|classify|analyze|followup|free_report|paid_report)(?:_(?:rewrite|review)_[012])?$/.test(
      name,
    )
    ? name
    : "other";
}
function safeFailure(error) {
  const names = new Set([
    "APIError",
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "APIUserAbortError",
    "AuthenticationError",
    "PermissionDeniedError",
    "RateLimitError",
    "BadRequestError",
    "InternalServerError",
    "SyntaxError",
    "LengthFinishReasonError",
    "ContentFilterFinishReasonError",
    "AbortError",
    "TimeoutError",
  ]);
  return {
    errorClass: names.has(error?.name) ? error.name : "other",
    httpStatus:
      Number.isInteger(error?.status) &&
      error.status >= 100 &&
      error.status <= 599
        ? error.status
        : null,
  };
}
const safeCount = (n) =>
  Number.isSafeInteger(n) && n >= 0 && n <= 1e9 ? n : null;

// Exclusive creation prohibits silently resetting a crashed run's budget.
// This journal contains only counts/reservations. A crash is a stop, never
// permission to create a new journal and repeat calls under the same approval.
export async function createEvaluationLedger(path) {
  const handle = await open(path, "wx", 0o600);
  return {
    async checkpoint(summary) {
      await handle.writeFile(JSON.stringify(summary) + "\n");
      await handle.sync();
    },
    close: () => handle.close(),
  };
}

// Dependency injection keeps CI offline. The live caller must provide a scoped
// OpenAI client with SDK retries disabled, after separate cost approval.
// This gate does not create/load credentials or enable any external test.
/** @param {unknown} client
 * @param {{ deadline?: number, now?: () => number, checkpoint?: (summary: object) => Promise<void>, prior?: {calls:number, reservedNano:number, cases:object, inputTokens:number, outputTokens:number, completed:number, unknownCalls:number} }} options */
export function evaluationProvider(
  client,
  { deadline = NaN, now = Date.now, checkpoint = undefined, prior } = {},
) {
  if (
    !Number.isFinite(deadline) ||
    deadline <= now() ||
    deadline > now() + 1200000 ||
    typeof checkpoint !== "function"
  )
    throw Error("EVAL_DEADLINE_REQUIRED");
  if (
    prior &&
    (!Number.isSafeInteger(prior.reservedNano) ||
      prior.reservedNano < 0 ||
      prior.reservedNano > 12000000000 ||
      !Number.isInteger(prior.calls) ||
      prior.calls < 0 ||
      prior.calls > 842 ||
      ![
        prior.completed,
        prior.unknownCalls,
        prior.inputTokens,
        prior.outputTokens,
      ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      Object.values(prior.cases).reduce((a, b) => a + b, 0) !== prior.calls ||
      prior.completed + prior.unknownCalls !== prior.calls)
  )
    throw Error("EVAL_RECOVERY_DENIED");
  const used = new Map(Object.entries(prior?.cases ?? {}));
  const observed = {
    inputTokens: prior?.inputTokens ?? 0,
    outputTokens: prior?.outputTokens ?? 0,
    completed: prior?.completed ?? 0,
  };
  let reservedNano = prior?.reservedNano ?? 0,
    calls = prior?.calls ?? 0,
    stopped = false,
    busy = false;
  let stopDiagnostic = null;
  return {
    async parse(group, caseNumber, request) {
      const cap = ["consultation", "diagnosis"].includes(group)
        ? aiEvaluation[group]
        : null;
      const key = `${group}:${caseNumber}`;
      if (
        stopped ||
        busy ||
        now() >= deadline ||
        !cap ||
        !Number.isInteger(caseNumber) ||
        caseNumber < 1 ||
        caseNumber > cap.cases ||
        (used.get(key) ?? 0) >= cap.callsPerCase ||
        calls >= 842
      )
        throw Error("EVAL_ALLOWANCE_DENIED");
      const allowed = [
        "model",
        "input",
        "text",
        "max_output_tokens",
        "store",
        "reasoning",
        "service_tier",
      ];
      if (
        !request ||
        Object.keys(request).some((k) => !allowed.includes(k)) ||
        request.model !== aiEvaluation.model ||
        request.store !== false ||
        (request.service_tier && request.service_tier !== "default") ||
        !Number.isInteger(request.max_output_tokens) ||
        request.max_output_tokens < 1 ||
        request.max_output_tokens > cap.outputTokens ||
        !Array.isArray(request.input) ||
        !request.input.every(
          (m) =>
            ["system", "developer", "user", "assistant"].includes(m.role) &&
            typeof m.content === "string" &&
            Object.keys(m).every((k) => ["role", "content"].includes(k)),
        )
      )
        throw Error("EVAL_REQUEST_DENIED");
      // Official model context ceiling includes message/schema formatting.
      // No local tokenizer estimate is used as a billing guarantee.
      // Standard long-context 12h write $0.50/M, output $0.75/M, +10%.
      const params = structuredClone(request);
      const format = request.text?.format;
      if (format?.$brand && typeof format.$parseRaw === "function") {
        Object.defineProperties(params.text.format, {
          $brand: { value: format.$brand },
          $parseRaw: { value: format.$parseRaw },
        });
      }
      params.service_tier = "default";
      const hold = 1050000 * 550 + request.max_output_tokens * 825;
      if (reservedNano + hold > 12000000000) throw Error("EVAL_COST_DENIED");
      // Every dispatch attempt counts. Unknown/failed outcomes retain the full hold.
      used.set(key, (used.get(key) ?? 0) + 1);
      calls++;
      reservedNano += hold;
      busy = true;
      const stage = safeStage(format?.name);
      let reason = "reservation_persistence_failed",
        response = null;
      try {
        await checkpoint({
          phase: "reserved",
          calls,
          reservedUSD: reservedNano / 1e9,
          cases: Object.fromEntries(used),
          group,
          caseNumber,
          stage,
        });
        reason = "deadline_before_dispatch";
        if (now() >= deadline) throw Error("DEADLINE_REACHED");
        const signal = AbortSignal.timeout(Math.min(110000, deadline - now()));
        const options = { signal, maxRetries: 0 };
        // Reject excess context instead of silently truncating evaluation input.
        params.truncation = "disabled";
        reason = "provider_exception";
        const result = await client.responses.parse(params, options);
        const u = result.usage;
        response = {
          status: [
            "completed",
            "incomplete",
            "failed",
            "cancelled",
            "queued",
            "in_progress",
          ].includes(result.status)
            ? result.status
            : "other",
          modelMatches: result.model === aiEvaluation.model,
          tierMatches: result.service_tier === "default",
          inputTokens: safeCount(u?.input_tokens),
          outputTokens: safeCount(u?.output_tokens),
          incompleteReason: ["max_output_tokens", "content_filter"].includes(
            result.incomplete_details?.reason,
          )
            ? result.incomplete_details.reason
            : null,
        };
        const responseAfterDeadline = now() >= deadline;
        reason = responseAfterDeadline
          ? "deadline_after_response"
          : result.status !== "completed"
            ? "response_not_completed"
            : result.model !== aiEvaluation.model
              ? "model_mismatch"
              : result.service_tier !== "default"
                ? "tier_mismatch"
                : "usage_invalid_or_over_cap";
        if (
          responseAfterDeadline ||
          result.status !== "completed" ||
          result.model !== aiEvaluation.model ||
          result.service_tier !== "default" ||
          !u ||
          !Number.isInteger(u.input_tokens) ||
          u.input_tokens < 0 ||
          u.input_tokens > cap.inputTokens ||
          !Number.isInteger(u.output_tokens) ||
          u.output_tokens < 0 ||
          u.output_tokens > params.max_output_tokens
        )
          throw Error("USAGE_REJECTED");
        // Keep a conservative settled cost, not a claim of invoiced cost.
        // Input verified <= original case cap (short context); assume all input
        // at the most expensive 12h write rate and include regional premium.
        const settled = u.input_tokens * 275 + u.output_tokens * 550;
        const nextReserved = reservedNano - hold + settled;
        const nextObserved = {
          inputTokens: observed.inputTokens + u.input_tokens,
          outputTokens: observed.outputTokens + u.output_tokens,
          completed: observed.completed + 1,
        };
        reason = "settlement_persistence_failed";
        await checkpoint({
          phase: "usage_observed",
          calls,
          reservedUSD: nextReserved / 1e9,
          ...nextObserved,
          billedUSD: null,
          group,
          caseNumber,
          stage,
        });
        Object.assign(observed, nextObserved);
        reservedNano = nextReserved;
        return result;
      } catch (error) {
        stopped = true;
        stopDiagnostic = {
          group,
          caseNumber,
          stage,
          reason,
          ...safeFailure(error),
          response,
        };
        try {
          await checkpoint({
            phase: "stopped",
            calls,
            reservedUSD: reservedNano / 1e9,
            ...observed,
            diagnostic: stopDiagnostic,
          });
        } catch {
          /* Never release the hold or expose a persistence error. */
        }
        // Never propagate raw provider errors, URLs, headers or response bodies.
        throw Error("EVAL_PROVIDER_STOPPED");
      } finally {
        busy = false;
      }
    },
    summary() {
      return {
        calls,
        reservedUSD: reservedNano / 1e9,
        stopped,
        ...observed,
        billedUSD: null,
        unknownCalls: calls - observed.completed,
        stopDiagnostic,
      };
    },
  };
}
