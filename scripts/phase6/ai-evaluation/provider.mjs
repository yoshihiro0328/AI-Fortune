import { aiEvaluation } from "../subscription-runtime/remaining-plan.mjs";
import { open } from "node:fs/promises";

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
 * @param {{ deadline?: number, now?: () => number, checkpoint?: (summary: object) => Promise<void> }} options */
export function evaluationProvider(
  client,
  { deadline = NaN, now = Date.now, checkpoint = undefined } = {},
) {
  if (
    !Number.isFinite(deadline) ||
    deadline <= now() ||
    deadline > now() + 1200000 ||
    typeof checkpoint !== "function"
  )
    throw Error("EVAL_DEADLINE_REQUIRED");
  const used = new Map();
  const observed = { inputTokens: 0, outputTokens: 0, completed: 0 };
  let reserved = 0,
    calls = 0,
    stopped = false,
    busy = false;
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
        (used.get(key) ?? 0) >= cap.callsPerCase
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
      const hold =
        ((cap.inputTokens * 0.25 + request.max_output_tokens * 0.5) / 1e6) *
        1.1;
      if (reserved + hold > aiEvaluation.proposedReservationUSD)
        throw Error("EVAL_COST_DENIED");
      // Both counters and the full reservation remain consumed on every error.
      used.set(key, (used.get(key) ?? 0) + 1);
      calls++;
      reserved += hold;
      busy = true;
      try {
        await checkpoint({
          phase: "reserved",
          calls,
          reservedUSD: reserved,
          cases: Object.fromEntries(used),
        });
        if (now() >= deadline) throw Error("DEADLINE_REACHED");
        const params = structuredClone(request);
        const format = request.text?.format;
        if (format?.$brand && typeof format.$parseRaw === "function") {
          Object.defineProperties(params.text.format, {
            $brand: { value: format.$brand },
            $parseRaw: { value: format.$parseRaw },
          });
        }
        params.service_tier = "default";
        const signal = AbortSignal.timeout(Math.min(110000, deadline - now()));
        const options = { signal, maxRetries: 0 };
        const countParams = {
          model: params.model,
          input: params.input,
          text: params.text,
          ...(params.reasoning ? { reasoning: params.reasoning } : {}),
        };
        const count = await client.responses.inputTokens.count(
          countParams,
          options,
        );
        if (
          !Number.isInteger(count.input_tokens) ||
          count.input_tokens < 0 ||
          count.input_tokens > cap.inputTokens ||
          now() >= deadline
        )
          throw Error("COUNT_REJECTED");
        // Preserve SDK's non-enumerable structured-output parser, while all
        // transmitted fields remain equal to the token-counted plain clone.
        const result = await client.responses.parse(params, options);
        const u = result.usage;
        if (
          now() >= deadline ||
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
        observed.inputTokens += u.input_tokens;
        observed.outputTokens += u.output_tokens;
        observed.completed++;
        await checkpoint({
          phase: "usage_observed",
          calls,
          reservedUSD: reserved,
          ...observed,
          billedUSD: null,
        });
        return result;
      } catch {
        stopped = true;
        // Never propagate raw provider errors, URLs, headers or response bodies.
        throw Error("EVAL_PROVIDER_STOPPED");
      } finally {
        busy = false;
      }
    },
    summary() {
      return {
        calls,
        reservedUSD: reserved,
        stopped,
        ...observed,
        billedUSD: null,
      };
    },
  };
}
