export const conversationStyle = `読み手を「相談者」「ユーザー」と呼ばず、必要なら「あなた」と呼ぶ。「これは相談者側の前向きな姿勢です」のような第三者への報告文にしない。冒頭は経歴の箇条書きのようにせず、相談の具体的な変化を受け止める自然な1文から入る。「判断の軸」「段階です」「〜することが有効」「〜する必要があります」のような解説口調を避ける。不明点の箇条書きで「分かりません」を何度も繰り返さず、まだ確かめられていない事柄として短く表す。恋愛相談に詳しい落ち着いた人が、20〜40代の相談者に話しかける自然な日本語。優しいが現実的に、短い文で書く。慰めだけ、説教、過剰な敬語、翻訳調、論文調は避ける。「会う」「話す」「連絡する」「やり取りする」を使う。「面会」「接触」「対話」「相手方」「当該」「意思疎通」「静観」「推察」「考察」「示唆」「見受けられる」「関係性を構築」「コミュニケーションを図る」は使わない。同じ段落で「可能性があります」「考えられます」「かもしれません」「大切です」「状況です」を繰り返さない。一文は90文字以内を目安に分ける。相手の気持ちは決めつけず、分からない点は短く伝える。相談者が伝えた具体的な出来事を受け止め、次にできることをはっきり伝える。根拠のない期待や不安を加えない。連絡を断られているときは尊重する。`;
export type TextLeaf = { path: string; text: string };
export function textLeaves(
  value: unknown,
  scope = "report",
  path = "",
): TextLeaf[] {
  if (typeof value === "string")
    return scope !== "followup" || /^questions\.\d+\.question$/.test(path)
      ? [{ path, text: value }]
      : [];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    textLeaves(child, scope, path ? `${path}.${key}` : key),
  );
}
export function mergeText<T>(
  original: T,
  edits: TextLeaf[],
  scope = "report",
): T {
  const leaves = textLeaves(original, scope);
  const map = new Map(edits.map((e) => [e.path, e.text]));
  if (
    map.size !== edits.length ||
    map.size !== leaves.length ||
    leaves.some((e) => !map.has(e.path))
  )
    throw new Error("Rewrite changed the document structure");
  for (const leaf of leaves) {
    // Quantities, durations and dates must survive the editorial pass unchanged.
    const numbers = (s: string) =>
      s
        .normalize("NFKC")
        .match(/\d+(?:\.\d+)?/g)
        ?.join(",") ?? "";
    if (numbers(leaf.text) !== numbers(map.get(leaf.path)!))
      throw new Error("Rewrite changed numbers");
  }
  function visit(value: unknown, path = ""): unknown {
    if (map.has(path)) return map.get(path);
    if (Array.isArray(value))
      return value.map((v, i) => visit(v, `${path}.${i}`));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          visit(v, path ? `${path}.${k}` : k),
        ]),
      );
    return value;
  }
  return visit(original) as T;
}
export function styleIssues(leaves: TextLeaf[]) {
  const issues: string[] = [];
  const banned =
    /相談者|ユーザー|面会|接触|対話|相手方|当該|意思疎通|静観|推察|考察|示唆|見受けられ|関係性を構築|コミュニケーションを(?:図|取)/;
  for (const { path, text } of leaves) {
    if (banned.test(text))
      issues.push(`${path}: 堅い表現 ${text.match(banned)?.[0]}`);
    if (text.split(/[。！？\n]/).some((s) => s.length > 110))
      issues.push(`${path}: 文が長すぎる`);
    for (const ending of [
      "可能性があります",
      "考えられます",
      "かもしれません",
      "大切です",
      "状況です",
    ])
      if (text.split(ending).length > 2)
        issues.push(`${path}: ${ending} の繰り返し`);
  }
  return issues;
}
