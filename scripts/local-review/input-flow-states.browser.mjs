import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out = "/private/tmp/yorisoi-input-flow-review";
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
const b = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const width of [320, 390, 1280, 1440, 1920]) {
    const c = await b.newContext({ viewport: { width, height: 720 } });
    c.setDefaultNavigationTimeout(60000);
    let external = 0;
    await c.route("**/*", (r) =>
      new URL(r.request().url()).origin === base
        ? r.continue()
        : (external++, r.abort()),
    );
    await c.request.post(base + "/__review/scenario", {
      maxRedirects: 0,
      headers: {
        origin: base,
        "content-type": "application/x-www-form-urlencoded",
      },
      data: "mode=free",
    });
    const p = await c.newPage();
    await p.goto(base + "/chat?topic=reply", { waitUntil: "networkidle" });
    await p.locator("#trial-text").fill("【合成】キャンセルしても保持");
    await p.locator("#screenshot-import > summary").click();
    await p
      .getByRole("button", { name: "合成画像を用意する", exact: true })
      .click();
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    // Open OCR controls must span the composer on desktop, rather than stay in its compact button column.
    if (width >= 1280) {
      const o = await p.locator("#screenshot-import").boundingBox(),
        f = await p.locator(".p6-composer").boundingBox();
      assert.ok(o.width > f.width * 0.85);
    }
    await p
      .getByRole("button", { name: "画像・抽出結果を破棄する", exact: true })
      .click();
    await p.locator("#screenshot-import > summary").click();
    await expect(p.locator("#trial-text")).toHaveValue(
      "【合成】キャンセルしても保持",
    );
    await p.locator("#trial-text").focus();
    await p.keyboard.type("。");
    await expect(p.locator("#trial-text")).toHaveValue(
      "【合成】キャンセルしても保持。",
    );
    await c.route("**/api/consultations?thread=*", async (route) => {
      const response = await route.fetch(),
        d = await response.json();
      if (d.turns?.length) {
        const sample = d.turns[0];
        d.turns = [
          ...Array.from({ length: 12 }, (_, i) => ({
            ...sample,
            id: "synthetic-old-" + i,
            user_text: "【合成】過去の会話 " + i,
            assistant_text: "【合成】読み返し位置の確認。".repeat(20),
          })),
          ...d.turns,
        ];
      }
      await route.fulfill({ response, json: d });
    });
    await p.goto(base + "/consult?thread=sample-thread", {
      waitUntil: "networkidle",
    });
    const hist = p.locator(".chat-messages");
    await expect(hist).toBeVisible();
    await expect
      .poll(() =>
        hist.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
      )
      .toBeLessThan(2);
    await hist.evaluate((e) => (e.scrollTop = 120));
    await p.waitForTimeout(150);
    await p.locator("#chat-text").fill("【合成】読み返し中の追加相談");
    const before = await hist.evaluate((e) => e.scrollTop);
    await p.getByRole("button", { name: "相談を送る", exact: true }).click();
    await expect(p.locator("#chat-text")).toHaveValue("");
    await expect.poll(() => hist.evaluate((e) => e.scrollTop)).toBe(before);
    // Another reply while already at the bottom follows the new turn within the region.
    await hist.evaluate((e) => (e.scrollTop = e.scrollHeight));
    await p.waitForTimeout(150);
    await p.locator("#chat-text").fill("【合成】末尾で新しい回答を確認");
    await p.getByRole("button", { name: "相談を送る", exact: true }).click();
    await expect(p.locator("#chat-text")).toHaveValue("");
    await expect
      .poll(() =>
        hist.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
      )
      .toBeLessThan(2);
    assert.equal(external, 0);
    results.push({
      width,
      ocrCancelDraft: true,
      ocrExpandedWidth: true,
      readPositionPreserved: true,
      newReplyFollowsAtEnd: true,
    });
    console.log("states", width);
    await c.close();
  }
} finally {
  await b.close();
  await fs.writeFile(
    out + "/extra-states.json",
    JSON.stringify(results, null, 2),
  );
}
