import { expect, it } from "vitest";
import {
  detectBubbles,
  restoreMessages,
  markOverlap,
  type Bubble,
  type PositionedLine,
} from "@/lib/screenshot/line-layout";
import { confirmedTranscript, type QuoteRow } from "@/lib/screenshot/model";
const box = (x0: number, y0: number, x1: number, y1: number) => ({
  x0,
  y0,
  x1,
  y1,
});
const bubbles: Bubble[] = [
  { box: box(50, 150, 280, 240), speaker: "other", clipped: false },
  { box: box(230, 280, 470, 350), speaker: "me", clipped: false },
  { box: box(200, 390, 470, 470), speaker: "me", clipped: false },
];
const line = (
  text: string,
  bbox: ReturnType<typeof box>,
  confidence = 95,
): PositionedLine => ({ text, bbox, confidence });
it("groups by bubbles rather than text lines, keeps consecutive bubbles separate and excludes header/name/time/read text", () => {
  const lines = [
    line("合成画像：架空の名前・アイコン", box(10, 10, 450, 40)),
    line("10月28日", box(180, 90, 260, 110)),
    line("上の行", box(70, 160, 180, 180)),
    line("下の行", box(70, 200, 180, 220)),
    line("19:35", box(290, 210, 330, 230)),
    line("既読", box(180, 300, 220, 320)),
    line("次の文", box(250, 300, 350, 330)),
    line("続けて送った文", box(220, 400, 420, 430)),
  ];
  const r = restoreMessages(lines, bubbles, 0, 500, 700);
  expect(r.unsupported).toBe(false);
  expect(r.rows.map((r) => [r.speaker, r.text])).toEqual([
    ["other", "上の行\n下の行"],
    ["me", "次の文"],
    ["me", "続けて送った文"],
  ]);
  expect(r.rows[0].time).toBe("19:35");
  expect(r.rows[0].date).toBe("10月28日");
  expect(confirmedTranscript(r.rows)).not.toMatch(/既読|合成画像|19:35/);
});
it("does not guess unavailable speaker geometry, truncated bubbles or missing text", () => {
  const r = restoreMessages(
    [line("読めた部分", box(70, 160, 180, 180), 30)],
    [{ ...bubbles[0], clipped: true }],
    0,
    500,
    700,
  );
  expect(r.rows[0].speaker).toBe("unknown");
  expect(r.rows[0].uncertain).toBe(true);
  expect(() => confirmedTranscript(r.rows)).toThrow();
  expect(
    restoreMessages([], bubbles, 0, 500, 700, true).rows.every(
      (r) => r.speaker === "unknown",
    ),
  ).toBe(true);
});
it("rejects visible group evidence, plain text and OCR without coordinates", () => {
  expect(
    restoreMessages(
      [line("友人（12）", box(30, 10, 250, 35))],
      bubbles,
      0,
      500,
      700,
    ).unsupported,
  ).toBe(true);
  expect(restoreMessages([], [], 0, 500, 700).unsupported).toBe(true);
  const r = restoreMessages(
    [{ text: "位置なし", confidence: 99 }],
    bubbles,
    0,
    500,
    700,
  );
  expect(r.rows.every((r) => r.uncertain && !r.text.includes("位置なし"))).toBe(
    true,
  );
});
it("does not silently fold possible quotation into new message", () => {
  const r = restoreMessages(
    [
      line("前の文", box(70, 160, 200, 180)),
      line("新しい文", box(70, 200, 200, 220)),
    ],
    [{ ...bubbles[0], inset: true }],
    0,
    500,
    700,
  );
  expect(r.rows[0].quotePending).toBe(true);
  expect(() => confirmedTranscript(r.rows)).toThrow();
  expect(
    confirmedTranscript([
      { ...r.rows[0], quotePending: false, quote: "前の文", text: "新しい文" },
    ]),
  ).toContain("[引用・発言者未確定] 前の文\n[新しく書かれた本文] 新しい文");
});
it("only marks overlapping runs across image boundary; repeated isolated text and conflicting timestamps are preserved", () => {
  const row = (
    id: string,
    image: number,
    text: string,
    speaker: QuoteRow["speaker"] = "me",
    time?: string,
  ): QuoteRow => ({ id, image, text, speaker, time, uncertain: false });
  const rows = [
    row("a", 0, "最初"),
    row("b", 0, "またね"),
    row("c", 0, "ありがとう", "other"),
    row("d", 1, "またね"),
    row("e", 1, "ありがとう", "other"),
    row("f", 1, "ありがとう"),
  ];
  const r = markOverlap(rows);
  expect(r.map((r) => r.duplicateOf)).toEqual([
    undefined,
    undefined,
    undefined,
    "b",
    "c",
    undefined,
  ]);
  expect(r).toHaveLength(6);
  expect(
    markOverlap([row("a", 0, "ありがとう"), row("b", 1, "ありがとう")]).every(
      (r) => !r.duplicateOf,
    ),
  ).toBe(true);
  expect(
    markOverlap([
      row("a", 0, "A", "me", "10:00"),
      row("b", 0, "B"),
      row("c", 1, "A", "me", "11:00"),
      row("d", 1, "B"),
    ]).every((r) => !r.duplicateOf),
  ).toBe(true);
});
it("detects regions independent of text and fixed bubble color, excluding avatar region", () => {
  for (const [bg, ink] of [
    [120, 230],
    [30, 80],
    [170, 90],
  ]) {
    const w = 300,
      h = 400,
      data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([bg, bg, bg, 255], i * 4);
    for (const [x0, y0, x1, y1] of [
      [30, 80, 170, 130],
      [140, 180, 285, 240],
      [4, 80, 20, 96],
    ])
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          data.set([ink, ink, ink, 255], (y * w + x) * 4);
    expect(detectBubbles(data, w, h).map((b) => b.speaker)).toEqual([
      "other",
      "me",
    ]);
  }
});
it("keeps a quoted inset within its parent even when avatar components were filtered", () => {
  const w = 500,
    h = 600,
    data = new Uint8ClampedArray(w * h * 4);
  const rect = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) data.set([v, v, v, 255], (y * w + x) * 4);
  };
  rect(0, 0, w, h, 120);
  rect(4, 90, 25, 120, 200);
  rect(180, 150, 475, 260, 240);
  rect(195, 160, 460, 195, 170);
  const r = detectBubbles(data, w, h);
  expect(r).toHaveLength(1);
  expect(r[0].inset).toBe(true);
});
it("a mask that removes alignment evidence cannot turn an incoming bubble into a certain outgoing one", () => {
  const w = 500,
    h = 600,
    data = new Uint8ClampedArray(w * h * 4);
  const rect = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) data.set([v, v, v, 255], (y * w + x) * 4);
  };
  rect(0, 0, w, h, 120);
  rect(50, 150, 450, 230, 240);
  rect(40, 140, 180, 240, 17);
  const bubbles = detectBubbles(data, w, h);
  expect(bubbles).toHaveLength(1);
  expect(bubbles[0].obscured).toBe(true);
  expect(restoreMessages([], bubbles, 0, w, h).rows[0].speaker).toBe("unknown");
});
