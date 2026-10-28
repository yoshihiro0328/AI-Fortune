import { expect, it } from "vitest";
import { reviewRows } from "@/lib/screenshot/ocr";
import fs from "node:fs";
import crypto from "node:crypto";
it("keeps unknown speakers, order, duplicates, newlines, emoji and uncertainty without inventing content", () => {
  const r = reviewRows(
    [
      { text: "ありがとう🙂\n19:35", confidence: 90 },
      { text: "ありがとう🙂\n19:35", confidence: 90 },
      { text: "□", confidence: 20 },
      { text: "  ", confidence: 0 },
    ],
    2,
  );
  expect(r.map((x) => x.speaker)).toEqual(["unknown", "unknown", "unknown"]);
  expect(r[0].text).toBe(r[1].text);
  expect(r[2].uncertain).toBe(true);
  expect(r[0].id).toBe("2-0");
});
it("all self-hosted OCR assets match their pinned hashes", () => {
  const m = JSON.parse(fs.readFileSync("public/ocr/manifest.json", "utf8"));
  for (const [name, v] of Object.entries(m.files) as [
    string,
    { sha256: string },
  ][]) {
    expect(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync("public/ocr/" + name))
        .digest("hex"),
    ).toBe(v.sha256);
  }
});
