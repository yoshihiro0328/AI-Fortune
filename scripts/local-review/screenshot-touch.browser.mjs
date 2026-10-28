// CDP touch emulation is not evidence of physical smartphone performance.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out = "/private/tmp/yorisoi-screenshot-editor-review";
const b = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const route of ["/chat?topic=reply", "/consult?thread=sample-thread"]) {
    const c = await b.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    let external = 0;
    await c.route("**/*", (r) =>
      new URL(r.request().url()).origin === base
        ? r.continue()
        : (external++, r.abort()),
    );
    const p = await c.newPage();
    await p.goto(base + route, { waitUntil: "networkidle", timeout: 60000 });
    const s = p.locator("#screenshot-import");
    await s.locator(":scope>summary").tap();
    await s
      .getByRole("button", { name: "合成画像を用意する", exact: true })
      .tap();
    const ed = s.locator(".screenshot-picture"),
      stage = ed.locator(".image-stage");
    await ed.getByLabel("表示倍率").selectOption("2");
    await ed
      .getByRole("button", { name: "画像上で範囲を選ぶ", exact: true })
      .tap();
    await ed.locator(".image-viewport").scrollIntoViewIfNeeded();
    const session = await c.newCDPSession(p);
    const drag = async (x, y, dx, dy, cancel = false) => {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let i = 1; i <= 8; i++)
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
        });
      await session.send("Input.dispatchTouchEvent", {
        type: cancel ? "touchCancel" : "touchEnd",
        touchPoints: [],
      });
    };
    let box = await stage.boundingBox();
    const before = await p.evaluate(() => scrollY);
    await drag(
      box.x + box.width * 0.1,
      box.y + box.height * 0.1,
      box.width * 0.2,
      box.height * 0.2,
    );
    await expect(ed.locator(".image-selection")).toBeVisible();
    assert.equal(
      await p.evaluate(() => scrollY),
      before,
      "selection cannot scroll page",
    );
    await ed.getByRole("button", { name: "選択範囲を隠す", exact: true }).tap();
    assert.deepEqual(
      await ed
        .locator("canvas")
        .evaluate((c) =>
          Array.from(c.getContext("2d").getImageData(128, 140, 1, 1).data),
        ),
      [17, 17, 17, 255],
    );
    await ed.getByLabel("表示倍率").selectOption("1");
    assert.deepEqual(
      await ed
        .locator("canvas")
        .evaluate((c) =>
          Array.from(c.getContext("2d").getImageData(128, 140, 1, 1).data),
        ),
      [17, 17, 17, 255],
    );
    // A second mask leaves the first in place; undo restores only the second.
    await stage.press("Space");
    await stage.press("ArrowDown");
    await ed.getByRole("button", { name: "選択範囲を隠す", exact: true }).tap();
    assert.deepEqual(
      await ed
        .locator("canvas")
        .evaluate((c) =>
          Array.from(c.getContext("2d").getImageData(400, 400, 1, 1).data),
        ),
      [17, 17, 17, 255],
    );
    await ed.getByRole("button", { name: "ひとつ戻す", exact: true }).tap();
    assert.notDeepEqual(
      await ed
        .locator("canvas")
        .evaluate((c) =>
          Array.from(c.getContext("2d").getImageData(400, 400, 1, 1).data),
        ),
      [17, 17, 17, 255],
    );
    assert.deepEqual(
      await ed
        .locator("canvas")
        .evaluate((c) =>
          Array.from(c.getContext("2d").getImageData(128, 140, 1, 1).data),
        ),
      [17, 17, 17, 255],
    );
    // Outside image scroll is still a native page gesture, even in selection mode.
    await ed
      .getByRole("button", { name: "画像上で範囲を選ぶ", exact: true })
      .tap();
    await stage.scrollIntoViewIfNeeded();
    const y0 = await p.evaluate(() => scrollY);
    await drag(8, 600, 0, -180);
    await p.waitForTimeout(300);
    assert.ok((await p.evaluate(() => scrollY)) > y0);
    await ed.getByRole("button", { name: "範囲選択を終了", exact: true }).tap();
    await stage.scrollIntoViewIfNeeded();
    box = await stage.boundingBox();
    const y1 = await p.evaluate(() => scrollY);
    await drag(box.x + box.width / 2, box.y + box.height * 0.8, 0, -100);
    await p.waitForTimeout(300);
    assert.ok(
      (await p.evaluate(() => scrollY)) > y1,
      "view mode image allows page scroll",
    );
    // Switch to pointer selection again, then cancel the pointer; restore the previous rectangle.
    await ed
      .getByRole("button", { name: "画像上で範囲を選ぶ", exact: true })
      .tap();
    await stage.scrollIntoViewIfNeeded();
    box = await stage.boundingBox();
    await drag(box.x + 20, box.y + 20, 40, 40, true);
    await expect(ed.locator(".image-selection")).toHaveCount(0);
    assert.equal(external, 0);
    results.push({
      route,
      emulatedTouch: true,
      zoomMappedPixel: true,
      outsideScroll: true,
      viewScroll: true,
      pointerCancel: true,
      physicalDevice: false,
    });
    await c.close();
  }
  await fs.writeFile(out + "/touch.json", JSON.stringify(results, null, 2));
  console.log("Emulated touch checks passed");
} finally {
  await b.close();
}
