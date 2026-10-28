import { createHash } from "node:crypto";
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
// Pure validation: callers supply private, owner-only records. No API replay.
/** @param {{journal:string,expectedHash:string,prior:any,elapsedMillis:number,firstReceiptAt:number,extension?:{scope:string,maxMillis:number,receivedAt:number},now?:number,cases:any[],results:any,review:any,safetyStages:any}} options */
export function continuationPlan({
  journal,
  expectedHash,
  prior,
  elapsedMillis,
  firstReceiptAt,
  extension,
  now = Date.now(),
  cases,
  results,
  review,
  safetyStages,
}) {
  if (digest(journal) !== expectedHash) throw Error("HISTORY_HASH");
  if (
    !Number.isSafeInteger(firstReceiptAt) ||
    firstReceiptAt > now ||
    (!extension && now >= firstReceiptAt + 1200000)
  )
    throw Error("RECEIPT_DEADLINE");
  if (
    extension &&
    (extension.scope !== "purpose-five-cases-10m-v1" ||
      extension.maxMillis !== 600000 ||
      !Number.isSafeInteger(extension.receivedAt) ||
      extension.receivedAt > now ||
      now >= extension.receivedAt + extension.maxMillis)
  )
    throw Error("EXTENSION_REQUIRED");
  const wallElapsed = extension ? 1200000 : now - firstReceiptAt;
  const entries = journal
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  const last = entries.at(-1);
  if (
    !last ||
    last.phase !== "observed" ||
    last.unknown !== 0 ||
    last.calls !== last.completed ||
    digest(JSON.stringify(last.priorPreserved)) !==
      digest(JSON.stringify(prior))
  )
    throw Error("HISTORY_UNCONFIRMED");
  if (
    !Number.isSafeInteger(elapsedMillis) ||
    elapsedMillis < last.elapsedMillis - prior.elapsedMillis ||
    elapsedMillis >= 1200000
  )
    throw Error("HISTORY_TIME");
  const observed = new Map();
  for (const e of entries) {
    if (e.phase === "reserved") {
      if (observed.has(e.id)) throw Error("HISTORY_REPLAY");
      observed.set(e.id, false);
    } else if (e.phase === "observed") {
      if (observed.get(e.id) !== false) throw Error("HISTORY_ORDER");
      observed.set(e.id, true);
    } else throw Error("HISTORY_UNCONFIRMED");
  }
  if (observed.size !== last.calls || [...observed.values()].some((x) => !x))
    throw Error("HISTORY_UNCONFIRMED");
  const selected = [];
  /** @type {Record<string, {hash:string,result:any,usage:any}>} */
  const reuse = {};
  for (const c of cases) {
    const old = results[c.id];
    if (!old) {
      if ([...observed.keys()].some((id) => id.startsWith(c.id + "-")))
        throw Error("PARTIAL_CASE_REQUIRES_RECONCILIATION");
      selected.push({ ...c, evaluationId: c.id });
      continue;
    }
    if (JSON.stringify(old.input) !== JSON.stringify(c))
      throw Error("CASE_CHANGED");
    const verdict = review[c.id];
    if (verdict !== "pass" && verdict !== "fail")
      throw Error("REVIEW_REQUIRED");
    if (verdict === "fail") {
      const safety = safetyStages[c.id];
      if (
        !observed.get(c.id + "-0") ||
        !safety?.usageVerified ||
        !safety.hash ||
        !safety.result ||
        safety.result.safety !== false
      )
        throw Error("SAFETY_REUSE");
      const evaluationId = c.id + "-correction1";
      selected.push({ ...c, evaluationId });
      reuse[evaluationId + "-0"] = safety;
    }
  }
  if (
    extension &&
    JSON.stringify(selected.map((c) => c.evaluationId)) !==
      JSON.stringify([
        "contradiction-reply-correction1",
        "waiting-organize",
        "danger-reply",
        "danger-review",
        "danger-organize",
      ])
  )
    throw Error("EXTENSION_CASE_SCOPE");
  return {
    selected,
    reuse,
    carried: {
      calls: last.calls,
      completed: last.completed,
      reservedNano: last.reservedNano,
      inputTokens: last.inputTokens,
      outputTokens: last.outputTokens,
      elapsedMillis: Math.max(elapsedMillis, wallElapsed),
    },
  };
}
