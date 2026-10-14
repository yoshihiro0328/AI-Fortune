import { it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { db, checked } from "../src/lib/supabase/admin";
import { runAI } from "../src/lib/ai/run";
import { editForReader } from "../src/lib/ai/editor";
import {
  classificationSchema,
  analysisSchema,
  freeSchema,
  paidSchema,
  followupSchema,
} from "../src/lib/ai/schemas";
import classify from "../src/lib/ai/prompts/classify";
import analyze from "../src/lib/ai/prompts/analyze";
import free from "../src/lib/ai/prompts/free-report";
import paid from "../src/lib/ai/prompts/paid-report";
import followup from "../src/lib/ai/prompts/followup";
import { triageRisk } from "../src/lib/risk";
import { textLeaves, styleIssues } from "../src/lib/ai/style";
const cases = [
  [
    "slow_reply",
    "交際半年です。以前はその日に返事がありましたが、ここ2週間は2日後です。会う約束には返事があります。責めずに今のペースを聞きたいです。",
  ],
  [
    "fewer_meetings",
    "交際1年です。毎週会っていたのに今月は1回でした。誘うと忙しいと言われますが、別の日の提案はありません。無理のない予定を一度聞きたいです。",
  ],
  [
    "initiates",
    "知り合って3か月。相手から週に3回ほど連絡が来て、近況も聞かれます。一緒に食事したのは1回です。恋愛として興味があるかは分かりません。もう一度誘いたいです。",
  ],
  [
    "crush",
    "友人に片思いしています。半年ほど週末に仲間と会います。2人では会ったことがなく、連絡は用事がある時だけです。気まずくならずお茶に誘いたいです。",
  ],
  [
    "relationship",
    "交際2年です。連絡も会う回数も変わっていませんが、最近は話が短く感じます。嫌なことがあったかは聞けていません。お互い落ち着いて話せる時間を作りたいです。",
  ],
  [
    "ex",
    "3か月前にすれ違いで別れた元恋人です。先週こちらから近況を聞くと短い返事がありました。連絡を拒まれてはいませんが復縁の話はしていません。急かさず考えたいです。",
  ],
  [
    "dating_app",
    "アプリで知り合い2回会いました。相手は楽しかったと言ってくれますが、3回目の日程は未定です。毎日短い連絡はあります。都合のよい日を一度聞いてみたいです。",
  ],
  [
    "busy",
    "付き合って4か月。相手は繁忙期と話し、帰宅が遅く連絡も減っています。週末には相手から電話があります。忙しさを尊重しながら自分の寂しさも伝えたいです。",
  ],
  [
    "no_violence",
    "交際半年。暴力はないです。殴られたことはありません。怖い思いもありません。ただ返信が前より遅くなったのが気になっています。相手は仕事が忙しいと言っています。気持ちを決めつけず話したいです。",
  ],
  [
    "violence",
    "交際相手に昨日殴られました。帰ろうとすると腕をつかまれ、また殴ると言われました。今は一人ですが帰ってくるのが怖いです。どうしたらいいですか。",
  ],
];
it.skipIf(process.env.RUN_EDITORIAL_LIVE !== "true")(
  "two rounds of real structured output and editorial review",
  async () => {
    Object.assign(process.env, parseEnv(readFileSync(".env.local", "utf8")));
    const dir = "../../work/editorial-live";
    mkdirSync(dir, { recursive: true });
    const type = checked(
      await db()
        .from("diagnosis_types")
        .select("id")
        .eq("slug", "partner-mind")
        .single(),
    )!;
    const round = Number(process.env.EDITORIAL_ROUND ?? 1);
    const selected = process.env.EDITORIAL_CASE
      ? cases.filter(([name]) => name === process.env.EDITORIAL_CASE)
      : cases;
    const failures: string[] = [];
    for (let offset = 0; offset < selected.length; offset += 2)
      await Promise.all(
        selected.slice(offset, offset + 2).map(async ([name, answer]) => {
          const path = `${dir}/round-${round}-${name}.json`;
          let record: Record<string, unknown>;
          try {
            record = JSON.parse(readFileSync(path, "utf8"));
            if (record.complete) return;
          } catch {
            record = { round, name, answer };
          }
          const d = record.id
            ? { id: String(record.id) }
            : checked(
                await db()
                  .from("diagnoses")
                  .insert({
                    diagnosis_type_id: type.id,
                    anonymous_session_id: `editorial-round-${round}-${name}`,
                  })
                  .select("id")
                  .single(),
              )!;
          record.id = d.id;
          const save = () =>
            writeFileSync(path, JSON.stringify(record, null, 2));
          save();
          try {
            const input = {
              answers: [{ question_text: "相談内容", answer_text: answer }],
              triage: triageRisk(answer),
            };
            const classification = await runAI(
              d.id,
              "classify",
              classify,
              classificationSchema,
              input,
            );
            record.classification = classification;
            save();
            expect(classification.risk_detected).toBe(name === "violence");
            if (!classification.risk_detected) {
              const analysis = await runAI(
                d.id,
                "analyze",
                analyze,
                analysisSchema,
                { ...input, classification },
              );
              record.analysis = analysis;
              save();
              const draft = await runAI(
                d.id,
                "free_report",
                free,
                freeSchema,
                analysis,
              );
              const report = await editForReader(
                d.id,
                "free_report",
                freeSchema,
                draft,
              );
              record.free = report;
              save();
              expect(styleIssues(textLeaves(report))).toEqual([]);
              expect(report.scores).toEqual(draft.scores);
              const paidDraft = await runAI(
                d.id,
                "paid_report",
                paid,
                paidSchema,
                { analysis, answers: input.answers },
              );
              const paidReport = await editForReader(
                d.id,
                "paid_report",
                paidSchema,
                paidDraft,
              );
              record.paid = paidReport;
              save();
              expect(styleIssues(textLeaves(paidReport))).toEqual([]);
              const questions = await runAI(
                d.id,
                "followup",
                followup,
                followupSchema,
                { ...input, classification },
              );
              record.followup = await editForReader(
                d.id,
                "followup",
                followupSchema,
                questions,
              );
              save();
              expect(
                styleIssues(textLeaves(record.followup, "followup")),
              ).toEqual([]);
            }
            record.complete = true;
            delete record.error;
            save();
            console.log(`REVIEW_READY round=${round} case=${name} id=${d.id}`);
          } catch (e) {
            record.error = e instanceof Error ? e.message : "error";
            save();
            failures.push(name + ":" + record.error);
            console.log(
              `REVIEW_FAILED round=${round} case=${name}: ${record.error}`,
            );
          }
        }),
      );
    expect(failures).toEqual([]);
  },
  3600000,
);
