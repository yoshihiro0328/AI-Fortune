// Synthetic local interaction regression; no credentials or external requests.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out =
    process.env.LOCAL_REVIEW_SCREENSHOTS ||
    "/private/tmp/yorisoi-ui-regression";
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
await fs.mkdir(out, { recursive: true });
const pages = [
  "/",
  "/chat",
  "/consult",
  "/diagnosis/partner-mind",
  "/account",
  "/plans",
  "/guides",
  "/help",
  "/result/sample-result",
  "/report/sample-result",
  "/guides/slow-replies",
  "/legal/privacy",
  "/legal/terms",
  "/legal/commerce",
  "/contact",
  "/legal/refund",
  "/safety",
  "/report-sample",
];
const results = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const c = await browser.newContext();
  c.setDefaultTimeout(15000);
  c.setDefaultNavigationTimeout(60000);
  await c.route("**/*", (route) =>
    new URL(route.request().url()).origin === base
      ? route.continue()
      : route.abort(),
  );
  const p = await c.newPage();
  for (const width of [320, 390, 430, 768, 999, 1000, 1280, 1440, 1920, 844]) {
    await p.setViewportSize({ width, height: width === 844 ? 390 : 900 });
    for (const [i, path] of pages.entries()) {
      console.log("Check", width, path);
      await p.goto(base + path, { waitUntil: "networkidle" });
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${path} ${width} overflow`,
      );
      if (width < 1000) {
        const trigger = p.getByRole("button", {
          name: "メニュー",
          exact: true,
        });
        await trigger.click();
        const d = p.locator("#site-menu-dialog");
        await expect(d).toBeVisible();
        await expect(d.locator("nav a")).toHaveCount(8);
        assert.ok(
          await d.evaluate((e) => e.scrollWidth <= e.clientWidth),
          `${path} ${width} menu overflow`,
        );
        const boxes = await d.locator("nav a").evaluateAll((xs) =>
          xs.map((e) => ({
            x: e.getBoundingClientRect().x,
            y: e.getBoundingClientRect().y,
            w: e.getBoundingClientRect().width,
            h: e.getBoundingClientRect().height,
          })),
        );
        assert.ok(
          boxes.every(
            (b, j) =>
              b.w === boxes[0].w && b.h >= 44 && (!j || b.y > boxes[j - 1].y),
          ),
          `${path} ${width} menu rows`,
        );
        const close = d.getByRole("button", { name: "メニューを閉じる" });
        await close.focus();
        await p.keyboard.press("Shift+Tab");
        await expect(d.locator("nav a").last()).toBeFocused();
        const cb = await close.boundingBox();
        assert.ok(
          cb.y >= 0 && cb.y + cb.height <= (width === 844 ? 390 : 900),
          `${path} close offscreen`,
        );
        await p.keyboard.press("Tab");
        await expect(close).toBeFocused();
        await p.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await trigger.click();
        assert.equal(
          await d.locator(".site-menu-list").evaluate((e) => e.scrollTop),
          0,
        );
        if (width === 390 || i === 0)
          await p.screenshot({ path: `${out}/menu-${i}-${width}.png` });
        await close.click();
        await expect(d).not.toBeVisible();
        assert.notEqual(
          await p.locator("body").evaluate((e) => getComputedStyle(e).overflow),
          "hidden",
        );
      } else if (
        pages.indexOf(path) >= 0 &&
        [
          "/chat",
          "/consult",
          "/account",
          "/diagnosis/partner-mind",
          "/result/sample-result",
          "/report/sample-result",
        ].includes(path)
      )
        await expect(p.locator(".app-sidebar nav a")).toHaveCount(8);
      if (width === 390 || width === 1280)
        await p.screenshot({ path: `${out}/page-${i}-${width}.png` });
      results.push({
        path,
        width,
        height: width === 844 ? 390 : 900,
        menuOpened: width < 1000,
        passed: true,
      });
    }
  }
  // Navigation, selected state, browser history, breakpoint close and zoom.
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(base + "/");
  for (const path of [
    "/chat",
    "/consult",
    "/diagnosis/partner-mind",
    "/account",
    "/plans",
    "/guides",
    "/help",
    "/",
  ]) {
    await p.getByRole("button", { name: "メニュー", exact: true }).click();
    await p.locator(`#site-menu-dialog a[href="${path}"]`).click();
    await p.waitForURL(base + path);
    await expect(p.locator("#site-menu-dialog")).not.toBeVisible();
    await p.getByRole("button", { name: "メニュー", exact: true }).click();
    await expect(
      p.locator(`#site-menu-dialog a[href="${path}"]`),
    ).toHaveAttribute("aria-current", "page");
    await p.keyboard.press("Escape");
  }
  await p.goBack();
  await p.goForward();
  await expect(p.locator("#site-menu-dialog")).not.toBeVisible();
  await p.getByRole("button", { name: "メニュー", exact: true }).click();
  await p.setViewportSize({ width: 1000, height: 800 });
  await expect(p.locator("#site-menu-dialog")).not.toBeVisible();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.addStyleTag({ content: "html{font-size:200%}" });
  await p.getByRole("button", { name: "メニュー", exact: true }).click();
  await expect(p.locator("#site-menu-dialog nav a")).toHaveCount(8);
  assert.ok(
    await p
      .locator("#site-menu-dialog")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  );
  await p.keyboard.press("Escape");
  await fs.writeFile(
    out + "/menu-results.json",
    JSON.stringify(
      {
        results,
        navigation: true,
        history: true,
        breakpoint: true,
        zoom200: true,
        physicalPhone: false,
      },
      null,
      2,
    ),
  );
  console.log(`Menu/page checks passed: ${results.length}`);
} finally {
  await browser.close();
}
