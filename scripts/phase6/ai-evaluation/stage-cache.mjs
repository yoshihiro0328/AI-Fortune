import { createHash } from "node:crypto";
import { open, readFile, rename } from "node:fs/promises";
import path from "node:path";

// Requests themselves are never logged. A pending marker blocks unknown replay;
// only durable, usage-verified structured results are reusable for this eval ID.
export function stageCache(directory) {
  return async (evaluationId, params, invoke) => {
    if (!/^diagnosis-(6|7)-revision-20261026$/.test(evaluationId))
      throw Error("CACHE_SCOPE_DENIED");
    const requestHash = createHash("sha256")
      .update(JSON.stringify(params))
      .digest("hex");
    const file = path.join(directory, `${evaluationId}-${requestHash}.json`);
    try {
      const saved = JSON.parse(await readFile(file, "utf8"));
      if (
        saved.evaluationId !== evaluationId ||
        saved.requestHash !== requestHash ||
        saved.state !== "completed" ||
        !saved.usageVerified
      )
        throw Error("UNKNOWN_STAGE_REPLAY_DENIED");
      return saved.result;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const stage =
      /^(?:classify|analyze|followup|free_report|paid_report)(?:_(?:rewrite|review)_[012])?$/.test(
        params.text?.format?.name,
      )
        ? params.text.format.name
        : "other";
    const base = {
      evaluationId,
      requestHash,
      stage,
      state: "pending",
      usageVerified: false,
    };
    async function durable(dst, value) {
      const h = await open(dst, "wx", 0o600);
      try {
        await h.writeFile(JSON.stringify(value));
        await h.sync();
      } finally {
        await h.close();
      }
    }
    await durable(file, base);
    const result = await invoke();
    const safe = {
      output_parsed: result.output_parsed,
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        input_tokens_details: {
          cached_tokens: result.usage.input_tokens_details?.cached_tokens ?? 0,
          cache_write_tokens:
            result.usage.input_tokens_details?.cache_write_tokens ?? 0,
        },
      },
    };
    if (
      /sk-[A-Za-z0-9_-]{20,}|https?:\/\/[^\s"]*[?&#](?:secret|token)=/.test(
        JSON.stringify(safe),
      )
    )
      throw Error("ARTIFACT_REJECTED");
    await durable(file + ".complete", {
      ...base,
      state: "completed",
      usageVerified: true,
      result: safe,
    });
    await rename(file + ".complete", file);
    return safe;
  };
}
