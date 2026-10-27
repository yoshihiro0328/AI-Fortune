import { getOperatorConfig } from "@/lib/operator";
import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/supabase/admin";
import {
  productionRuntime,
  productionEnvironment,
  ProductionStop,
} from "./config";
import { safeOperationalLog } from "./log";
export async function assertProductionSales() {
  if (!productionRuntime()) return;
  if (
    process.env.PUBLIC_POLICIES_APPROVED !== "true" ||
    !getOperatorConfig(process.env).isComplete
  )
    throw new ProductionStop();
  const environment = productionEnvironment();
  const r = await db().rpc("production_sales_allowed", {
    p_environment: environment,
  });
  if (r.error || r.data !== true) throw new ProductionStop();
}
type AIRequest = {
  model: string;
  store?: boolean;
  max_output_tokens?: number | null;
  input?: unknown;
  text?: unknown;
  reasoning?: unknown;
  service_tier?: unknown;
};
type AIResponse = {
  model: string;
  service_tier?: string | null;
  usage?: { input_tokens: number; output_tokens: number } | null;
};
// Production-only wrapper: existing isolated evaluation paths stay unchanged.
export async function withProductionBudget<
  R extends AIRequest,
  T extends AIResponse,
>(
  request: R,
  send: (request: R) => Promise<T>,
  reservationId?: string,
): Promise<T> {
  if (!productionRuntime()) return send(request);
  const environment = productionEnvironment();
  const limit = request.max_output_tokens;
  if (
    request.model !== "gpt-6-luna" ||
    request.store !== false ||
    !Number.isInteger(limit) ||
    limit! < 1 ||
    limit! > 8500 ||
    Object.keys(request).some(
      (k) =>
        ![
          "model",
          "store",
          "max_output_tokens",
          "input",
          "text",
          "reasoning",
          "service_tier",
        ].includes(k),
    ) ||
    (request.service_tier && request.service_tier !== "default")
  )
    throw new ProductionStop();
  // Text-only inputs, no images/tools/files/previous response chain or auto truncation.
  if (
    !Array.isArray(request.input) ||
    !request.input.every(
      (m) =>
        m &&
        ["system", "developer", "user", "assistant"].includes(m.role) &&
        typeof m.content === "string" &&
        Object.keys(m).every((k) => ["role", "content"].includes(k)),
    )
  )
    throw new ProductionStop();
  // Existing access-controlled call ID links accounting to its saved stage, never logs.
  const id = reservationId ?? randomUUID();
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const r = await db().rpc(name, {
      p_id: id,
      p_environment: environment,
      ...args,
    });
    if (r.error || r.data !== true) throw new ProductionStop();
  };
  // A lost RPC response never authorizes dispatch or a new reservation retry.
  await rpc("reserve_production_ai", { p_max_output: limit });
  await rpc("dispatch_production_ai", {});
  try {
    const response = await send({
      ...request,
      service_tier: "default",
      truncation: "disabled",
    });
    const usage = response.usage;
    if (
      response.model !== "gpt-6-luna" ||
      response.service_tier !== "default" ||
      !usage ||
      !Number.isSafeInteger(usage.input_tokens) ||
      !Number.isSafeInteger(usage.output_tokens) ||
      usage.input_tokens < 0 ||
      usage.input_tokens > 1050000 ||
      usage.output_tokens < 0 ||
      usage.output_tokens > limit!
    )
      throw new ProductionStop();
    await rpc("finish_production_ai", {
      p_input: usage.input_tokens,
      p_output: usage.output_tokens,
    });
    return response;
  } catch {
    let stopConfirmed = false;
    try {
      const stopped = await db().rpc("stop_unknown_production_ai", {
        p_id: id,
        p_environment: environment,
      });
      stopConfirmed = !stopped.error;
    } catch {
      /* Hold stays charged even if stop write fails. */
    }
    safeOperationalLog(
      stopConfirmed
        ? "production_ai_stopped"
        : "production_ai_stop_unconfirmed",
    );
    throw new ProductionStop();
  }
}
