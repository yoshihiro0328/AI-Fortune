import type { QuoteRow } from "./model";
export type Bounds = { x0: number; y0: number; x1: number; y1: number };
export type PositionedLine = {
  text: string;
  confidence: number;
  bbox?: Bounds;
};
export type Bubble = {
  box: Bounds;
  speaker: QuoteRow["speaker"];
  clipped: boolean;
  inset?: boolean;
  nonText?: boolean;
  obscured?: boolean;
};
// Connected flat interiors, including holes made by glyphs. No LINE color constants.
// Work on a downscaled bitmap so the number of queued pixels is bounded.
export function detectBubbles(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Bubble[] {
  const size = width * height,
    seen = new Uint8Array(size),
    queue = new Int32Array(size),
    result: Bubble[] = [];
  const key = (i: number) => {
    const p = i * 4;
    return (data[p] >> 5) * 64 + (data[p + 1] >> 5) * 8 + (data[p + 2] >> 5);
  };
  for (let seed = 0; seed < size; seed++) {
    if (seen[seed]) continue;
    seen[seed] = 1;
    const color = key(seed);
    let head = 0,
      tail = 1;
    queue[0] = seed;
    let x0 = width,
      y0 = height,
      x1 = 0,
      y1 = 0;
    while (head < tail) {
      const i = queue[head++],
        x = i % width,
        y = Math.floor(i / width);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const n of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ])
        if (n >= 0 && !seen[n] && key(n) === color) {
          seen[n] = 1;
          queue[tail++] = n;
        }
    }
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1,
      fill = tail / (w * h);
    if (
      w < width * 0.055 ||
      w > width * 0.94 ||
      h < 8 ||
      h > height * 0.65 ||
      fill < 0.52 ||
      color === 0
    )
      continue;
    const left = x0 / width,
      right = (x1 + 1) / width;
    const speaker =
      left >= 0.07 && left < 0.23 && right < 0.91
        ? "other"
        : right > 0.87 && left > 0.15
          ? "me"
          : "unknown";

    // A mask touching a detected left/right boundary can remove the original
    // alignment evidence. Never reclassify the remaining fragment confidently.
    const edgeBlack = (x: number) => {
      if (x < 0 || x >= width) return false;
      let black = 0,
        total = 0;
      for (let y = Math.ceil(y0 + h * 0.15); y < y0 + h * 0.85; y++) {
        const p = (y * width + x) * 4;
        total++;
        if (data[p] < 24 && data[p + 1] < 24 && data[p + 2] < 24) black++;
      }
      return black >= 3 && black > total * 0.2;
    };
    result.push({
      box: { x0, y0, x1: x1 + 1, y1: y1 + 1 },
      speaker,
      obscured: edgeBlack(x0 - 1) || edgeBlack(x1 + 1),
      nonText: fill < 0.85 && w / h > 0.65 && w / h < 1.4 && h < height * 0.22,
      clipped: x0 < 2 || x1 > width - 3 || y0 < 2 || y1 > height - 3,
    });
  }
  // A quoted inset or image inside a bubble is not a separate message.
  return result
    .map((r) => ({
      ...r,
      inset: result.some(
        (p) =>
          p !== r &&
          p.box.x0 > r.box.x0 &&
          p.box.y0 > r.box.y0 &&
          p.box.x1 < r.box.x1 &&
          p.box.y1 < r.box.y1 &&
          p.box.x1 - p.box.x0 > (r.box.x1 - r.box.x0) * 0.3,
      ),
    }))
    .filter(
      (r) =>
        !(
          r.speaker === "unknown" &&
          ((r.box.x0 / width > 0.24 && r.box.x1 / width < 0.8) ||
            r.box.x1 / width < 0.15)
        ),
    )
    .filter(
      (r) =>
        !result.some(
          (p) =>
            p.box.x0 <= r.box.x0 &&
            p.box.y0 <= r.box.y0 &&
            p.box.x1 >= r.box.x1 &&
            p.box.y1 >= r.box.y1 &&
            (p.box.x1 - p.box.x0) * (p.box.y1 - p.box.y0) >
              (r.box.x1 - r.box.x0) * (r.box.y1 - r.box.y0),
        ),
    )
    .sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
}
const compact = (s: string) => s.replace(/\s/g, "");
const time = (s: string) =>
  /^(?:既読)?\s*(?:[01]?\d|2[0-3])[:：][0-5]\d$/.test(compact(s));
const date = (s: string) =>
  /^(?:\d{4}[年/.-])?\d{1,2}[月/.-]\d{1,2}日?(?:[（(][月火水木金土日][）)])?$/.test(
    compact(s),
  );
function within(a: Bounds, b: Bounds) {
  const overlap =
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return overlap / Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0)) > 0.6;
}
export function restoreMessages(
  lines: PositionedLine[],
  bubbles: Bubble[],
  image: number,
  width: number,
  height: number,
  geometryLost = false,
) {
  const header = lines
    .filter((l) => l.bbox && l.bbox.y1 < height * 0.14)
    .map((l) => compact(l.text))
    .join(" ");
  const group = /グループ|[（(](?:[3-9]|[1-9]\d+)[）)]/.test(header);
  // Multiple distinct labels above incoming bubbles are evidence of multiple participants.
  const names = new Set(
    lines
      .filter(
        (l) =>
          l.bbox &&
          !bubbles.some((b) => within(l.bbox!, b.box)) &&
          !time(l.text) &&
          !date(l.text) &&
          l.bbox.y0 > height * 0.12 &&
          bubbles.some(
            (b) =>
              b.speaker === "other" &&
              l.bbox!.x0 >= b.box.x0 &&
              l.bbox!.x0 < b.box.x0 + width * 0.25 &&
              l.bbox!.y1 <= b.box.y0 &&
              b.box.y0 - l.bbox!.y1 < height * 0.04,
          ),
      )
      .map((l) => compact(l.text))
      .filter((t) => t && t !== "既読"),
  );
  if (group || names.size > 1)
    return {
      rows: [] as QuoteRow[],
      unsupported: true,
      warnings: [
        "複数人のトークを示す表示があります。LINEの1対1トークのみ対応しています。",
      ],
    };
  if (!bubbles.length)
    return {
      rows: [] as QuoteRow[],
      unsupported: true,
      warnings: [
        "吹き出しを確認できません。平文・グループ・他アプリの画像は対象外です。",
      ],
    };
  const rows = bubbles.map((b, i): QuoteRow => {
    const inside = lines
      .filter((l) => l.bbox && within(l.bbox, b.box))
      .sort((a, c) => a.bbox!.y0 - c.bbox!.y0 || a.bbox!.x0 - c.bbox!.x0);
    const issues: string[] = [];
    if (b.obscured)
      issues.push("黒塗りなどで吹き出しの端が隠れ、左右の根拠が不足しています");
    if (b.clipped) issues.push("吹き出しが画像端で切れています");
    if (geometryLost)
      issues.push("横方向の切り抜きにより左右の根拠が不足しています");
    if (b.speaker === "unknown") issues.push("吹き出しの配置を判定できません");
    if (!inside.length)
      issues.push(
        "スタンプ・写真・隠された文字など、本文を読み取れない領域です",
      );
    if (inside.some((l) => l.confidence < 85 || /[�□]/u.test(l.text)))
      issues.push("文字に誤読・欠落の可能性があります");
    // A word such as 「返信」 is ordinary message text. Only a detected inset
    // region is evidence of a possible quoted block; line wrapping is not.
    const quote = Boolean(b.inset && inside.length > 1);
    if (quote)
      issues.push("引用返信の可能性：引用と新しい本文を分けてください");
    const nearby = lines.filter(
      (l) =>
        l.bbox &&
        !bubbles.some((other) => within(l.bbox!, other.box)) &&
        l.bbox.y1 >= b.box.y0 &&
        l.bbox.y0 <= b.box.y1 &&
        Math.min(
          Math.abs(l.bbox.x1 - b.box.x0),
          Math.abs(l.bbox.x0 - b.box.x1),
        ) <
          width * 0.2,
    );
    const stamp = nearby.find((l) => time(l.text))?.text.trim();
    const day = lines
      .filter(
        (l) =>
          l.bbox &&
          l.bbox.y1 <= b.box.y0 &&
          date(l.text) &&
          !bubbles.some((other) => within(l.bbox!, other.box)) &&
          Math.abs((l.bbox.x0 + l.bbox.x1) / 2 - width / 2) < width * 0.15,
      )
      .sort((a, c) => a.bbox!.y0 - c.bbox!.y0)
      .at(-1)
      ?.text.trim();
    const text = inside
      .map((l) => l.text.trim())
      .filter(Boolean)
      .join("\n");
    const unavailable = /送信を取り消しました|メッセージが削除されました/.test(
      text,
    );
    if (unavailable)
      issues.push("取り消し・削除表示です。本文は復元していません");
    return {
      id: `${image}-${i}`,
      image,
      sourceBox: b.box,
      speaker: geometryLost || b.clipped || b.obscured ? "unknown" : b.speaker,
      text: text || "[文字として読めない内容]",
      uncertain: issues.length > 0,
      issues,
      time: stamp,
      date: day,
      quotePending: quote,
    };
  });
  return {
    rows,
    unsupported: false,
    warnings: [
      "スタンプ・写真・背景と同化した吹き出しなどを見落とす場合があります。画像全体と照合してください。",
    ],
  };
}
export function markOverlap(rows: QuoteRow[]): QuoteRow[] {
  const next = rows.map((r) => ({
    ...r,
    duplicateOf: undefined as string | undefined,
  }));
  // Only suffix/prefix runs across adjacent images; identical isolated words are never removed.
  const images = [...new Set(rows.map((r) => r.image))];
  for (let i = 1; i < images.length; i++) {
    const a = next.filter((r) => r.image === images[i - 1]),
      b = next.filter((r) => r.image === images[i]);
    for (let n = Math.min(a.length, b.length); n >= 2; n--) {
      const suffix = a.slice(-n);
      if (
        suffix.every(
          (r, j) =>
            compact(r.text) === compact(b[j].text) &&
            r.speaker === b[j].speaker &&
            r.speaker !== "unknown" &&
            (!r.time || !b[j].time || compact(r.time) === compact(b[j].time)) &&
            (!r.date || !b[j].date || compact(r.date) === compact(b[j].date)),
        )
      ) {
        b.slice(0, n).forEach((r, j) => {
          r.duplicateOf = suffix[j].id;
        });
        break;
      }
    }
  }
  return next;
}
