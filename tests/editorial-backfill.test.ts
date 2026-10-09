import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { db, checked } from "../src/lib/supabase/admin";
import { editForReader } from "../src/lib/ai/editor";
import { freeSchema, paidSchema } from "../src/lib/ai/schemas";
import { version } from "../src/lib/ai/prompts/base";
it.skipIf(process.env.RUN_EDITORIAL_BACKFILL !== "true")(
  "backfill existing reports with original preserved and facts reviewed",
  async () => {
    Object.assign(process.env, parseEnv(readFileSync(".env.local", "utf8")));
    const results: unknown[] = [];
    for (const [table, scope, schema] of [
      ["free_reports", "free_report", freeSchema],
      ["paid_reports", "paid_report", paidSchema],
    ] as const) {
      let query = db()
        .from(table)
        .select("id,diagnosis_id,report_json,prompt_version,model")
        .neq("prompt_version", version);
      if (table === "paid_reports") query = query.eq("status", "ready");
      const rows = checked(await query) ?? [];
      for (const row of rows) {
        const stage = `legacy_${scope}_original`;
        const backup = checked(
          await db()
            .from("ai_calls")
            .select("id")
            .eq("diagnosis_id", row.diagnosis_id)
            .eq("stage", stage)
            .maybeSingle(),
        );
        if (!backup)
          checked(
            await db()
              .from("ai_calls")
              .insert({
                diagnosis_id: row.diagnosis_id,
                stage,
                model: row.model,
                prompt_version: row.prompt_version,
                success: true,
                output_json: row.report_json,
              }),
          );
        try {
          const original = schema.parse(row.report_json);
          // Separate branches retain each schema's inferred shape.
          const report =
            table === "free_reports"
              ? await editForReader(
                  row.diagnosis_id,
                  scope,
                  freeSchema,
                  freeSchema.parse(original),
                )
              : await editForReader(
                  row.diagnosis_id,
                  scope,
                  paidSchema,
                  paidSchema.parse(original),
                );
          let update = db()
            .from(table)
            .update({ report_json: report, prompt_version: version })
            .eq("id", row.id)
            .eq("prompt_version", row.prompt_version);
          if (table === "paid_reports") update = update.eq("status", "ready");
          const saved = checked(await update.select("id"));
          expect(saved?.length).toBe(1);
          results.push({ table, id: row.diagnosis_id, ok: true });
        } catch (e) {
          results.push({
            table,
            id: row.diagnosis_id,
            ok: false,
            error: (e as Error).message,
          });
        }
        writeFileSync(
          "../../work/editorial-backfill.json",
          JSON.stringify(results, null, 2),
        );
      }
    }
    expect(results.every((r) => (r as { ok: boolean }).ok)).toBe(true);
  },
  3600000,
);
