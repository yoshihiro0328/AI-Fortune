import "server-only";
import { z } from "zod";
import { db, checked } from "../supabase/admin";
import { version } from "./prompts/base";
import { runAI, type RunOptions } from "./run";
import { conversationStyle, textLeaves, mergeText, styleIssues } from "./style";
const editsSchema = z.object({
  edits: z.array(
    z.object({ path: z.string(), text: z.string().min(1).max(5000) }),
  ),
});
const reviewSchema = z.object({
  faithful: z.boolean(),
  natural: z.boolean(),
  safe: z.boolean(),
  actionable: z.boolean(),
  issues: z.array(z.string()),
});
export async function editForReader<T>(
  id: string,
  scope: string,
  schema: z.ZodType<T>,
  original: T,
  options: RunOptions = {},
) {
  const leaves = textLeaves(original, scope);
  if (!leaves.length) return schema.parse(original);
  let issues: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const result = await runAI(
      id,
      `${scope}_rewrite_${pass}`,
      `${conversationStyle}\nあなたは最終編集者。入力originalの各pathについて自然な日本語のtextを返す。pathの追加・削除は禁止。分析、事実、理由、不確実性、助言の条件・強さ、否定、数量は一切変えない。数字は元の順序のまま残す。固有の出来事を一般論へ薄めない。新しい助言や日数を足さない。引用メッセージは送れる自然な文にする。問題点issuesをすべて解消する。自然な箇所も含め全pathを返す。`,
      editsSchema,
      { original: leaves, issues },
      {
        ...options,
        attempts: 1,
        maxTokens: scope === "paid_report" ? 8500 : 4500,
        timeout: 90000,
      },
    );
    let candidate: T;
    try {
      candidate = schema.parse(mergeText(original, result.edits, scope));
    } catch {
      issues = [
        "構造または数量を変更しないこと。全pathを保持し、数字を元と同じ順序で残すこと。",
      ];
      continue;
    }
    issues = styleIssues(textLeaves(candidate, scope));
    if (issues.length) continue;
    const review = await runAI(
      id,
      `${scope}_review_${pass}`,
      `${conversationStyle}\n文章の最終チェック。originalとeditedの各項目を比較。事実・分析・数値・否定・条件・不確実性・助言の意味が保たれればfaithful。追加削除や強さの変更があればfalse。人に話す自然な日本語で、長文・同じ語尾・レポート調・翻訳調・堅い言葉がなければnatural。断定・操作・不安を煽る内容がなければsafe。元に具体的行動がある場合はそれが伝わればactionable。追加質問や状況説明に行動がないこと自体は問題にしない。単なる好みで変更を求めないが実際の問題を見逃さない。問題はissuesへ具体的に書く。`,
      reviewSchema,
      { original: leaves, edited: textLeaves(candidate, scope) },
      { ...options, attempts: 1, maxTokens: 1800, timeout: 45000 },
    );
    if (
      review.faithful &&
      review.natural &&
      review.safe &&
      review.actionable &&
      !review.issues.length
    )
      return candidate;
    issues = [...review.issues, "事実や助言を変えず、自然で具体的な文章にする"];
  }
  // Keep the audit trail, but allow another job attempt to repair rejected wording.
  checked(
    await db()
      .from("ai_calls")
      .update({ cache_usable: false })
      .eq("diagnosis_id", id)
      .eq("prompt_version", version)
      .in("stage", [
        `${scope}_rewrite_0`,
        `${scope}_rewrite_1`,
        `${scope}_review_0`,
        `${scope}_review_1`,
      ]),
  );
  throw new Error("Editorial review did not pass; draft withheld");
}
