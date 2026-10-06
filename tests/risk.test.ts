import { describe, it, expect } from "vitest";
import { triageRisk } from "../src/lib/risk";
import { classificationSchema } from "../src/lib/ai/schemas";
describe("risk triage: negatives are context, not danger", () => {
  it.each([
    "暴力はないです",
    "暴力を振るわれたことはない",
    "殴られたことはありません",
    "脅迫されていません",
    "ストーカーではありません",
    "死にたいとは思っていません",
    "自傷したいわけではない",
    "ストーカーではないと思います",
  ])("%s", (text) => expect(triageRisk(text).level).toBe("none"));
  it.each([
    "昨日殴られました",
    "別れたら殺すと言われています",
    "家の前でずっと待たれています",
    "死にたいです",
    "無理やり性的なことをされました",
  ])("detects %s", (text) => expect(triageRisk(text).level).toBe("urgent"));
  it("does not mask an affirmative clause", () =>
    expect(
      triageRisk("暴力はないと思っていましたが、昨日殴られました").level,
    ).toBe("urgent"));
  it("retains uncertain denials for context", () =>
    expect(triageRisk("暴力ではないと言われたけど怖いです").level).toBe(
      "caution",
    ));
  it("validates confidence", () =>
    expect(
      classificationSchema.safeParse({ risk_detected: false, confidence: 1.5 })
        .success,
    ).toBe(false));
});
