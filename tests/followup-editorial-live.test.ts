import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { db, checked } from "../src/lib/supabase/admin";
import { runAI } from "../src/lib/ai/run";
import { editForReader } from "../src/lib/ai/editor";
import { followupSchema } from "../src/lib/ai/schemas";
import followup from "../src/lib/ai/prompts/followup";
it.skipIf(process.env.RUN_FOLLOWUP_LIVE !== "true")(
  "rewrite real additional questions twice",
  async () => {
    Object.assign(process.env, parseEnv(readFileSync(".env.local", "utf8")));
    const t = checked(
      await db()
        .from("diagnosis_types")
        .select("id")
        .eq("slug", "partner-mind")
        .single(),
    )!;
    const records = [];
    for (let round = 1; round <= 2; round++) {
      const d = checked(
        await db()
          .from("diagnoses")
          .insert({
            diagnosis_type_id: t.id,
            anonymous_session_id: `editorial-followup-${round}`,
          })
          .select("id")
          .single(),
      )!;
      const original = await runAI(d.id, "followup", followup, followupSchema, {
        classification: {
          relationship_type: "不明",
          primary_concern: "相手が変わった",
          user_goal: "今後の関わり方を考えたい",
          risk_detected: false,
        },
        answers: [
          {
            question_text: "気になること",
            answer_text: "相手が前と変わりました。どうしたらいいですか。",
          },
        ],
      });
      expect(original.questions.length).toBeGreaterThan(0);
      const result = await editForReader(
        d.id,
        "followup",
        followupSchema,
        original,
      );
      expect(result.questions.map((q) => q.key)).toEqual(
        original.questions.map((q) => q.key),
      );
      records.push({ round, id: d.id, original, result });
      writeFileSync(
        "../../work/followup-editorial-live.json",
        JSON.stringify(records, null, 2),
      );
    }
  },
  240000,
);
