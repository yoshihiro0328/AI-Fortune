import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { required } from "../config";
import { db, checked } from "../supabase/admin";
import { base, version } from "./prompts/base";
export async function runAI<T>(
  id: string,
  stage: string,
  prompt: string,
  schema: z.ZodType<T>,
  input: unknown,
) {
  const model = required("OPENAI_MODEL");
  const client = new OpenAI({
    apiKey: required("OPENAI_API_KEY"),
    // A full report can take longer; two attempts still fit the 300s job lease.
    timeout: stage === "paid_report" ? 120000 : 45000,
    maxRetries: 0,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const start = Date.now();
    try {
      const r = await client.responses.parse({
        model,
        store: false,
        input: [
          { role: "system", content: base + "\n" + prompt },
          { role: "user", content: JSON.stringify({ untrusted_data: input }) },
        ],
        text: { format: zodTextFormat(schema, stage) },
        max_output_tokens: stage === "paid_report" ? 6500 : 2500,
      });
      const data = schema.parse(r.output_parsed);
      const it = r.usage?.input_tokens ?? 0,
        ot = r.usage?.output_tokens ?? 0;
      const a = process.env.OPENAI_INPUT_USD_PER_MILLION,
        b = process.env.OPENAI_OUTPUT_USD_PER_MILLION;
      checked(
        await db()
          .from("ai_calls")
          .insert({
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
          }),
      );
      return data;
    } catch (e) {
      await db()
        .from("ai_calls")
        .insert({
          diagnosis_id: id,
          stage,
          model,
          prompt_version: version,
          execution_time: Date.now() - start,
          success: false,
        });
      if (attempt === 1) throw e;
    }
  }
  throw new Error("AI unavailable");
}
