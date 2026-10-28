export const purposeIds = ["reply", "review", "organize"] as const;
export type Purpose = (typeof purposeIds)[number];
export const purposes: Record<Purpose, string> = {
  reply: "返信を考えたい",
  review: "自分で書いた文を見てほしい",
  organize: "気持ち・状況を整理したい",
};
// Stored with the submitted text so retries/regeneration retain their exact intent,
// without adding a database field or persisting an unsent draft.
export function submissionText(text: string, purpose?: Purpose | "") {
  return purpose ? `相談の目的：${purposes[purpose]}\n\n${text}` : text;
}
export function submissionPurpose(text: string): Purpose | undefined {
  return purposeIds.find((id) =>
    text.startsWith(`相談の目的：${purposes[id]}\n\n`),
  );
}
export const purposePrompt = `目的が「自分で書いた文を見てほしい」の場合、本人の意図と表現を尊重し、気になる箇所、その理由、必要最小限の修正文を示す。原文が適切なら無理に直さない。目的が「返信を考えたい」の場合、既に与えられた言葉や希望を聞き直さず、情報が足りるなら具体的な文案へ進む。送信用文面でも、本人が述べていない感情・経験・同意・希望を本人の発言として追加しない。相手の「楽しかった」という感情を本人も同じと扱わない。日時の食い違いを確かめるだけなら、確認文だけにし、入力にない「私も楽しかった」「会いたい」を添えない。言い回しを整えることと、気持ちや出来事を新しく作ることを区別する。目的が「気持ち・状況を整理したい」の場合、本人が述べた事実・本人の気持ち・推測・まだ分からないことを分ける。求めていない返信案や行動は押しつけず、整理だけを望む場合は整理で終える。未選択でも直接答える。質問だけで終わらず、今分かる範囲で役立つ答えを先に示し、本当に不可欠な確認だけ1つまで。相手の反応・成功を保証しない。コピーは送信や実行の証拠ではない。過去のAIの提案は、本人が実行したと明示するまで実行済みにしない。`;
export const replyFormatPrompt = `送信用の文面を提案する場合だけ、各文面を専用の行【送信用文面】と【文面ここまで】で囲む（最大3案）。この区切り内は相手へ送る文面だけ。理由・注意・使用条件・添削箇所は区切り外に書く。同意や断りを尊重する、文面そのものに必要な言葉は区切り内に残す。引用や相手の発言を送信用文面と誤分類しない。安全案内や送らない方がよい場面では送信用文面を作らない。`;
export function appendChange(text: string, change: string, max = 4000) {
  const combined = [text, change].filter(Boolean).join("\n\n");
  return combined.length <= max ? combined : null;
}
