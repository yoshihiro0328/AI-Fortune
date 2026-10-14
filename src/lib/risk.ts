// This is triage evidence for the contextual classifier, never a final safety verdict.
const negations = [
  /暴力(?:を振るわれたこと)?(?:は|が|も)?(?:一切)?(?:ない|ありません|なかった|ありませんでした)(?:です)?/g,
  /殴られたこと(?:は|が|も)?(?:ない|ありません)/g,
  /脅迫(?:は|されて|を受けて)(?:い)?(?:ない|ません|ありません)/g,
  /ストーカーでは(?:ありません|ない)(?:と思います)?/g,
  /死にたいと(?:は)?思って(?:い)?(?:ません|ない)/g,
  /自傷したいわけでは(?:ない|ありません)/g,
];
const cues =
  /(暴力|殴|殺す|殺され|死にたい|自殺|自傷|監禁|脅迫|ストーカー|性的強要|レイプ|\bDV\b|家の前.{0,12}待|無理やり.{0,12}性的|未成年|児童|犯罪|suicid|kill myself|stalk)/i;
const direct =
  /(昨日.{0,8}殴られ|殴られ(?:ました|ています|た)|殺すと(?:言われ|脅)|死にたい(?:です|気持ち)|家の前.{0,12}(?:ずっと)?待たれ|無理やり.{0,12}性的|閉じ込められ|監禁され)/;
export function triageRisk(text: string) {
  let remaining = text.normalize("NFKC");
  let negated = 0;
  for (const pattern of negations)
    remaining = remaining.replace(pattern, () => {
      negated++;
      return "[危険の否定表現]";
    });
  return {
    level: direct.test(remaining)
      ? "urgent"
      : cues.test(remaining)
        ? "caution"
        : "none",
    negated_mentions: negated,
    requires_context: true,
  };
}
