import "server-only";
import { randomUUID, createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { required } from "../config";
import { db, checked } from "../supabase/admin";
import { base, version } from "./prompts/base";
export type RunOptions = {
  deadline?: number;
  attempts?: number;
  timeout?: number;
  maxTokens?: number;
  fresh?: boolean;
};
export async function runAI<T>(
  id: string,
  stage: string,
  prompt: string,
  schema: z.ZodType<T>,
  input: unknown,
  options: RunOptions = {},
) {
  const model = required("OPENAI_MODEL");
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ prompt, input }))
    .digest("hex");
  if (!options.fresh) {
    const cached = checked(
      await db()
        .from("ai_calls")
        .select("output_json")
        .eq("diagnosis_id", id)
        .eq("stage", stage)
        .eq("model", model)
        .eq("prompt_version", version)
        .eq("input_hash", inputHash)
        .eq("success", true)
        .eq("cache_usable", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    if (cached?.output_json) return schema.parse(cached.output_json);
  }
  const attempts = options.attempts ?? 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const remaining = (options.deadline ?? Date.now() + 120000) - Date.now();
    if (remaining < 5000)
      throw new Error("Generation budget exhausted; saved stages can resume");
    const callId = randomUUID();
    const start = Date.now();
    checked(
      await db().from("ai_calls").insert({
        id: callId,
        diagnosis_id: id,
        stage,
        model,
        prompt_version: version,
        input_hash: inputHash,
        success: false,
      }),
    );
    const client = new OpenAI({
      apiKey: required("OPENAI_API_KEY"),
      timeout: Math.min(
        remaining,
        options.timeout ?? (stage === "paid_report" ? 110000 : 50000),
      ),
      maxRetries: 0,
    });
    try {
      const r = await client.responses.parse({
        model,
        store: false,
        input: [
          { role: "system", content: base + "\n" + prompt },
          { role: "user", content: JSON.stringify({ untrusted_data: input }) },
        ],
        text: { format: zodTextFormat(schema, stage) },
        max_output_tokens:
          options.maxTokens ?? (stage === "paid_report" ? 6500 : 2500),
      });
      const data = schema.parse(r.output_parsed);
      const it = r.usage?.input_tokens ?? 0,
        ot = r.usage?.output_tokens ?? 0;
      const a = process.env.OPENAI_INPUT_USD_PER_MILLION,
        b = process.env.OPENAI_OUTPUT_USD_PER_MILLION;
      checked(
        await db()
          .from("ai_calls")
          .update({
            output_json: data,
            diagnosis_id: id,
            stage,
            model,
            prompt_version: version,
            input_tokens: it,
            output_tokens: ot,
            estimated_cost:
              a && b ? (it * Number(a) + ot * Number(b)) / 1e6 : null,
            execution_time: Date.now() - start,
            success: true,
          })
          .eq("id", callId),
      );
      return data;
    } catch (e) {
      await db()
        .from("ai_calls")
        .update({
          diagnosis_id: id,
          stage,
          model,
          prompt_version: version,
          execution_time: Date.now() - start,
          success: false,
        })
        .eq("id", callId);
      if (attempt === attempts - 1) throw e;
    }
  }
  throw new Error("AI unavailable");
}
