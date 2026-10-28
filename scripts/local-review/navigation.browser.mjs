// Presentation regression: local synthetic server, isolated browser, no external requests.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318";
const out = "/private/tmp/yorisoi-navigation-review";
const health = await fetch(base + "/__review/health").then((r) => r.json());
assert.deepEqual(
  [health.ready, health.synthetic, health.external],
  [true, true, false],
);
await fs.mkdir(out, { recursive: true });
const appPages = [
  ["chat", "/chat"],
  ["history", "/consult"],
  ["diagnosis", "/diagnosis/partner-mind"],
  ["result", "/result/sample-result"],
  ["report", "/report/sample-result"],
  ["account", "/account"],
];
const informationPages = [
  ["home", "/"],
  ["plans", "/plans"],
  ["guides", "/guides"],
  ["article", "/guides/slow-replies"],
  ["help", "/help"],
  ["terms", "/legal/terms"],
  ["privacy", "/legal/privacy"],
  ["sample", "/report-sample"],
  ["contact", "/contact"],
  ["safety", "/safety"],
];
const b = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
let desktopLinks;
try {
  for (const width of [1440, 390, 320]) {
    const c = await b.newContext({ viewport: { width, height: 1000 } });
    c.setDefaultTimeout(15000);
    c.setDefaultNavigationTimeout(60000);
    let external = 0;
    const errors = [];
    await c.route("**/*", (r) =>
      new URL(r.request().url()).origin === base
        ? r.continue()
        : (external++, r.abort()),
    );
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.name));
    const reset = (mode) =>
      c.request.post(base + "/__review/scenario", {
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=" + mode,
      });
    const go = async (path) => {
      assert.equal(
        (await p.goto(base + path, { waitUntil: "networkidle" })).status(),
        200,
      );
      await p.locator("main").waitFor();
    };
    const noOverflow = async () =>
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    await reset("free");
    for (const [name, path] of [...informationPages, ...appPages]) {
      await go(path);
      await noOverflow();
      const app = appPages.some(([, url]) => url === path);
      assert.equal(await p.locator(".app-sidebar").count(), app ? 1 : 0);
      assert.equal(await p.locator(".site-public-header").count(), app ? 0 : 1);
      assert.equal(await p.locator(".site-footer a").count(), 6);
      if (app) {
        const side = p.locator(".app-sidebar");
        const links = await side
          .locator("nav a")
          .evaluateAll((as) =>
            as.map((a) => [a.getAttribute("href"), a.textContent]),
          );
        if (!desktopLinks) desktopLinks = links;
        assert.deepEqual(links, desktopLinks);
        assert.equal(await side.locator("a[aria-current]").count(), 1);
        assert.equal(await side.isVisible(), width >= 1000);
        const x = await p
          .locator("main")
          .evaluate((e) => e.getBoundingClientRect().x);
        assert.equal(x, width >= 1000 ? 280 : 20);
      }
      if (width < 1000) {
        const trigger = p.getByRole("button", {
          name: "メニュー",
          exact: true,
        });
        await trigger.focus();
        await p.keyboard.press("Enter");
        const dialog = p.getByRole("dialog", { name: "メニュー", exact: true });
        await dialog.waitFor();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        assert.deepEqual(
          await dialog
            .locator("nav a")
            .evaluateAll((as) =>
              as.map((a) => [a.getAttribute("href"), a.textContent]),
            ),
          desktopLinks,
        );
        await dialog.getByRole("button", { name: "メニューを閉じる" }).focus();
        await p.keyboard.press("Shift+Tab");
        assert.ok(
          await dialog.evaluate((e) => e.contains(document.activeElement)),
        );
        await p.keyboard.press("Tab");
        assert.ok(
          await dialog.evaluate((e) => e.contains(document.activeElement)),
        );
        await p.keyboard.press("Escape");
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(trigger).toBeFocused();
        await trigger.click();
        await dialog.getByRole("button", { name: "メニューを閉じる" }).click();
        await expect(trigger).toBeFocused();
      }
      await p.screenshot({ path: `${out}/${name}-${width}.png` });
      results.push({
        width,
        name,
        app,
        noOverflow: true,
        navigation: true,
        footerSix: true,
        keyboardMenu: width < 1000,
      });
    }
    await go("/");
    assert.equal(await p.locator(".home-entry-links ul a").count(), 4);
    for (const a of await p.locator(".home-entry-links a,.site-login").all()) {
      const s = await a.evaluate((e) => ({
        h: e.getBoundingClientRect().height,
        underline: getComputedStyle(e).textDecorationLine,
        border: getComputedStyle(e).borderTopWidth,
      }));
      assert.ok(s.h >= 44);
      assert.equal(s.underline, "none");
      assert.notEqual(s.border, "0px");
    }
    const boxes = await p
      .locator(".home-entry-actions a")
      .evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
    assert.equal(boxes[0], boxes[1]);
    if (width < 1000) {
      const trigger = p.getByRole("button", { name: "メニュー", exact: true });
      await trigger.click();
      await p
        .getByRole("dialog")
        .getByRole("link", { name: "相談・履歴", exact: true })
        .click();
      await p.waitForURL(base + "/consult");
      await expect(p.locator("dialog[open]")).toHaveCount(0);
      await trigger.click();
      await p.screenshot({ path: `${out}/menu-${width}.png` });
      await p.setViewportSize({ width: 1280, height: 1000 });
      await expect(p.locator("dialog[open]")).toHaveCount(0);
      await p.setViewportSize({ width, height: 1000 });
    }
    for (const mode of [
      "anonymous",
      "unsaved",
      "plus",
      "scheduled",
      "canceled",
      "empty",
    ]) {
      await reset(mode);
      await go("/account");
      await noOverflow();
      assert.equal(await p.locator(".app-sidebar").count(), 1);
      results.push({ width, mode, account: true, noOverflow: true });
    }
    await reset("free");
    await go("/report/sample-result");
    await p.locator(".report-toc summary").first().focus();
    await p.keyboard.press("Enter");
    const first = p.locator(".report-toc a").first();
    await first.focus();
    await p.keyboard.press("Enter");
    assert.ok(new URL(p.url()).hash.startsWith("#report-item-"));
    await p.locator(".site-footer a").first().focus();
    assert.equal(
      await p
        .locator(".site-footer a")
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    assert.equal(external, 0);
    assert.deepEqual(errors, []);
    await c.close();
    console.log(JSON.stringify({ width, passed: true, external }));
  }
  await fs.writeFile(
    out + "/results.json",
    JSON.stringify(
      { results, externalRequests: 0, realUserData: false },
      null,
      2,
    ),
  );
} finally {
  await b.close();
}
