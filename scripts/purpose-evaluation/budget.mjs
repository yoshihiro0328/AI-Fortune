// No credentials, implicit authorization, or network creation in this module.
// Official context ceiling bounds input including schema/format overhead; no
// unsupported local tokenizer estimate is used to guarantee spend.
export const limits = Object.freeze({
  model: "gpt-6-luna",
  tier: "default",
  cases: 18,
  calls: 54,
  millis: 1200000,
  nanoUSD: 3e9,
  output: 4096,
  context: 1050000,
});
/**
 * @typedef {{calls:number,completed:number,reservedNano:number,inputTokens:number,outputTokens:number,elapsedMillis:number}} Carry
 * @param {{prior:any, checkpoint:(data:any)=>Promise<void>, now?:()=>number, startedAt?:number, carried?:Carry, extension?:{scope:string,receivedAt:number,maxMillis:number}}} options
 */
export function purposeBudget({
  prior,
  checkpoint,
  now = Date.now,
  startedAt = now(),
  extension,
  carried = {
    calls: 0,
    completed: 0,
    reservedNano: 0,
    inputTokens: 0,
    outputTokens: 0,
    elapsedMillis: 0,
  },
}) {
  if (
    !prior ||
    ![prior.calls, prior.reservedNano, prior.elapsedMillis].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    prior.calls > 842 ||
    prior.reservedNano > 12e9 ||
    typeof checkpoint !== "function"
  )
    throw Error("PRIOR_REQUIRED");
  if (
    ![
      "calls",
      "completed",
      "reservedNano",
      "inputTokens",
      "outputTokens",
      "elapsedMillis",
    ].every((k) => Number.isSafeInteger(carried[k]) && carried[k] >= 0) ||
    carried.calls !== carried.completed ||
    carried.calls > limits.calls ||
    carried.reservedNano > limits.nanoUSD ||
    (extension
      ? carried.elapsedMillis !== limits.millis
      : carried.elapsedMillis >= limits.millis)
  )
    throw Error("CARRY_REQUIRED");
  if (
    extension &&
    (extension.scope !== "purpose-five-cases-10m-v1" ||
      extension.maxMillis !== 600000 ||
      !Number.isSafeInteger(extension.receivedAt) ||
      extension.receivedAt > now() ||
      now() >= extension.receivedAt + extension.maxMillis)
  )
    throw Error("EXTENSION_REQUIRED");
  const deadline = extension
    ? extension.receivedAt + extension.maxMillis
    : startedAt + limits.millis - carried.elapsedMillis;
  const runStartedAt = extension?.receivedAt ?? startedAt;
  let calls = carried.calls,
    cost = carried.reservedNano,
    completed = carried.completed,
    input = carried.inputTokens,
    output = carried.outputTokens,
    stopped = false,
    busy = false;
  const stages = new Set();
  const summary = () => ({
    calls,
    completed,
    inputTokens: input,
    outputTokens: output,
    reservedNano: cost,
    unknown: calls - completed,
    priorPreserved: prior,
    cumulativeCalls: prior.calls + calls,
    cumulativeReservedNano: prior.reservedNano + cost,
    elapsedMillis:
      prior.elapsedMillis +
      carried.elapsedMillis +
      Math.max(0, now() - runStartedAt),
    carriedPreserved: carried,
    timeExtension: extension ?? null,
    billedUSD: null,
  });
  return {
    summary,
    async call(id, request, dispatch) {
      if (
        stopped ||
        busy ||
        stages.has(id) ||
        calls >= limits.calls ||
        prior.calls + calls >= 842 ||
        now() >= deadline
      )
        throw Error("PURPOSE_STOP");
      const keys = [
        "model",
        "store",
        "reasoning",
        "input",
        "text",
        "max_output_tokens",
        "service_tier",
      ];
      if (
        Object.keys(request).some((k) => !keys.includes(k)) ||
        request.model !== limits.model ||
        request.store !== false ||
        request.max_output_tokens < 1 ||
        request.max_output_tokens > limits.output ||
        !Number.isInteger(request.max_output_tokens) ||
        !Array.isArray(request.input) ||
        request.input.some(
          (m) =>
            !["system", "user", "assistant", "developer"].includes(m.role) ||
            typeof m.content !== "string" ||
            Object.keys(m).some((k) => !["role", "content"].includes(k)),
        ) ||
        (request.service_tier && request.service_tier !== limits.tier)
      )
        throw Error("PURPOSE_REQUEST");
      const hold = limits.context * 550 + request.max_output_tokens * 825;
      if (
        cost + hold > limits.nanoUSD ||
        prior.reservedNano + cost + hold > 12e9
      )
        throw Error("PURPOSE_BUDGET");
      busy = true;
      stages.add(id);
      calls++;
      cost += hold;
      try {
        await checkpoint({ phase: "reserved", id, ...summary() });
        if (now() >= deadline) throw Error("DEADLINE");
        const r = await dispatch(
          { ...request, service_tier: "default", truncation: "disabled" },
          {
            maxRetries: 0,
            signal: AbortSignal.timeout(Math.min(60000, deadline - now())),
          },
        );
        const u = r.usage;
        if (
          now() >= deadline ||
          r.status !== "completed" ||
          r.model !== limits.model ||
          r.service_tier !== "default" ||
          !u ||
          !Number.isInteger(u.input_tokens) ||
          u.input_tokens < 0 ||
          u.input_tokens > limits.context ||
          !Number.isInteger(u.output_tokens) ||
          u.output_tokens < 0 ||
          u.output_tokens > request.max_output_tokens
        )
          throw Error("UNCONFIRMED");
        // Same worst-case long-context/cache-write rate as the reservation.
        const settled = u.input_tokens * 550 + u.output_tokens * 825;
        await checkpoint({
          phase: "observed",
          id,
          ...summary(),
          reservedNano: cost - hold + settled,
          cumulativeReservedNano: prior.reservedNano + cost - hold + settled,
          completed: completed + 1,
          unknown: calls - completed - 1,
          inputTokens: input + u.input_tokens,
          outputTokens: output + u.output_tokens,
        });
        cost = cost - hold + settled;
        completed++;
        input += u.input_tokens;
        output += u.output_tokens;
        return r;
      } catch {
        stopped = true;
        await checkpoint({ phase: "stopped", id, ...summary() }).catch(
          () => {},
        );
        throw Error("PURPOSE_STOP");
      } finally {
        busy = false;
      }
    },
  };
}
