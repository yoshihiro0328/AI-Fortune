import type { Purpose } from "./purpose";
// Presentation only: never replaces the user's draft or alters submission prompts.
export const inputGuidance: Record<
  Purpose,
  { label: string; example: string; help: string }
> = {
  reply: {
    label: "相手から来た文と、どんな返事をしたいか",
    example:
      "例：『最近どう？』と来ました。近況を短く伝えて、相手の様子も聞きたいです。",
    help: "実名や連絡先を省き、届いた文とあなたの希望を書いてください。",
  },
  review: {
    label: "送ろうとしている文と、気になるところ",
    example:
      "例：『来週、時間が合えばお茶しない？』。急かす感じがしないか見てほしいです。",
    help: "あなたの意図や口調を残したいところも、自由に書けます。",
  },
  organize: {
    label: "あったことと、今迷っていること",
    example:
      "例：先週会った後、連絡が減りました。理由は分かりません。自分の気持ちを整理したいです。",
    help: "分かっていることと、まだ分からないことは分けて書けます。",
  },
};
