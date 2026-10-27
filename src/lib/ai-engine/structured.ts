import { productionRuntime, ProductionStop } from "@/lib/production/config";
import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
export type Usage = { input: number; output: number; providerId: string };
export class GenerationFailure extends Error {
  constructor(
    public usage?: Usage,
    public notSent = false,
    public anomaly = false,
  ) {
    super("Generation failed");
  }
}
export type SafetyDecision = { safety: boolean; answer: string };
export type SafetyPolicy = (input: string) => SafetyDecision | null;
export function costNusd(
  input: number,
  output: number,
  inputRate: number,
  outputRate: number,
) {
  if (
    ![input, output, inputRate, outputRate].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    )
  )
    throw new Error("Unknown pricing or usage");
  const cost = input * inputRate + output * outputRate;
  if (!Number.isSafeInteger(cost)) throw new Error("Cost overflow");
  return cost;
}
export async function structured<T>(args: {
  apiKey: string;
  projectId?: string;
  model: string;
  prompt: string;
  input: unknown;
  schema: z.ZodType<T>;
  inputLimit: number;
  outputLimit: number;
}) {
  // Anonymous trial is not approved for Production; never bypass shared controls.
  if (productionRuntime()) throw new ProductionStop();
  // Cache pricing is reserved at the highest input rate; store:false is not ZDR.
  const client = new OpenAI({
    apiKey: args.apiKey,
    project: args.projectId,
    baseURL: "https://api.openai.com/v1",
    organization: null,
    maxRetries: 0,
    timeout: 25000,
  });
  const input = [
    { role: "system" as const, content: args.prompt },
    {
      role: "user" as const,
      content: JSON.stringify({ untrusted_data: args.input }),
    },
  ];
  const text = { format: zodTextFormat(args.schema, "trial_answer") };
  let usage: Usage | undefined;
  let sent = false;
  try {
    const count = await client.responses.inputTokens.count({
      model: args.model,
      input,
      text,
    });
    if (
      !Number.isSafeInteger(count.input_tokens) ||
      count.input_tokens <= 0 ||
      count.input_tokens > args.inputLimit
    )
      throw new GenerationFailure(undefined, true);
    sent = true;
    // Read usage before parsing the answer: SDK parse() can throw on malformed
    // output and otherwise discard the billed usage from an HTTP 200 response.
    const response = await client.responses.create({
      model: args.model,
      store: false,
      service_tier: "default",
      reasoning: { effort: "low" },
      input,
      text,
      max_output_tokens: args.outputLimit,
    });
    if (
      response.usage &&
      [response.usage.input_tokens, response.usage.output_tokens].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      )
    )
      usage = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        providerId: response.id,
      };
    if (
      !usage ||
      response.model !== args.model ||
      response.service_tier !== "default"
    )
      throw new GenerationFailure(undefined, false, true);
    if (!usage || response.status !== "completed")
      throw new GenerationFailure(usage);
    return {
      value: args.schema.parse(JSON.parse(response.output_text)),
      usage,
    };
  } catch (e) {
    if (e instanceof GenerationFailure) throw e;
    throw new GenerationFailure(usage, !sent);
  }
}
