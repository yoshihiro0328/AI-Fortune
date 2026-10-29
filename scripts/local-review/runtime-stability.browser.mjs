// Fixed-build local regression. Synthetic data only; browser and server deny provider traffic.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { start, stop, origin as base } from "./runtime.mjs";
const out = process.env.LOCAL_REVIEW_SCREENSHOTS;
const directory = process.env.LOCAL_REVIEW_DIRECTORY;
assert(
  out && directory,
  "Provide private evidence and built review directories",
);
await fs.mkdir(out, { recursive: true });
const paths = [
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
  "/legal/privacy",
  "/legal/terms",
  "/legal/commerce",
  "/contact",
  "/legal/refund",
  "/safety",
  "/report-sample",
  "/legal/ai",
  "/legal/advertising",
  "/legal/disclaimer",
  ...[
    "slow-replies",
    "no-contact",
    "fewer-meetings",
    "mixed-signals",
    "reconciliation",
    "app-next-date",
    "changed-attitude",
    "unclear-relationship",
  ].map((x) => "/guides/" + x),
];
const report = {
  started: new Date().toISOString(),
  visits: [],
  states: [],
  memory: [],
  restarts: [],
  errors: [],
  external: 0,
};
async function health(label) {
  const h = await fetch(base + "/__review/health").then((r) => r.json());
  assert(
    h.ready && h.synthetic && !h.external && h.runtime === "production-build",
  );
  report.memory.push({ label, at: new Date().toISOString(), ...h });
  return h;
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  context.setDefaultTimeout(15000);
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== base) {
      report.external++;
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) =>
    report.errors.push({
      path: new URL(page.url()).pathname,
      message: e.message,
    }),
  );
  async function scenario(mode) {
    await context.request.post(base + "/__review/scenario", {
      headers: {
        origin: base,
        "content-type": "application/x-www-form-urlencoded",
      },
      data: "mode=" + mode,
    });
  }
  async function menu() {
    const trigger = page.getByRole("button", { name: "メニュー", exact: true });
    if (!(await trigger.isVisible())) return;
    await trigger.click();
    const dialog = page.locator("#site-menu-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("nav a")).toHaveCount(8);
    assert(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth));
    const close = dialog.getByRole("button", { name: "メニューを閉じる" });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator("nav a").last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await close.click();
    await expect(dialog).toBeHidden();
  }
  async function overflow(label) {
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      label,
    );
  }
  await scenario("free");
  await health("start");
  for (let round = 1; round <= 2; round++) {
    for (const width of [320, 390, 844, 1440]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 900 });
      for (const path of paths) {
        const response = await page.goto(base + path, {
          waitUntil: "networkidle",
        });
        assert.equal(response.status(), 200, path);
        await expect(page.locator("main")).toBeVisible();
        await menu();
        await overflow(`${round} ${width} ${path}`);
        // Exercise native wheel down/up, keyboard disclosure, footer navigation and browser back.
        await page.mouse.move(
          width / 2,
          Math.min(300, page.viewportSize().height - 50),
        );
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(80);
        const scrolled = await page.evaluate(() => scrollY);
        if (
          await page.evaluate(
            () => document.documentElement.scrollHeight > innerHeight + 100,
          )
        )
          assert(scrolled > 0, `${path} wheel stalled`);
        const summary = page.locator("main details > summary").first();
        if (await summary.count()) {
          await summary.focus();
          await page.keyboard.press("Enter");
          await expect(summary.locator("..")).toHaveAttribute("open", "");
          await page.keyboard.press("Enter");
        }
        const help = page.locator('footer a[href="/help"]').first();
        await help.click();
        await page.waitForURL(base + "/help");
        if (path !== "/help") {
          await page.goBack({ waitUntil: "networkidle" });
          assert.equal(new URL(page.url()).pathname, path);
        }
        await page.mouse.wheel(0, -10000);
        await page.waitForTimeout(80);
        if (round === 2) {
          // Double each original computed text size, including fixed-pixel styles.
          await page.evaluate(() => {
            const nodes = [...document.querySelectorAll("body *")];
            const sizes = nodes.map((e) =>
              parseFloat(getComputedStyle(e).fontSize),
            );
            nodes.forEach((e, i) => {
              if (e instanceof HTMLElement)
                e.style.fontSize = sizes[i] * 2 + "px";
            });
          });
          await overflow(`text200 ${width} ${path}`);
          await menu();
        }
        if (
          round === 1 &&
          [320, 1440].includes(width) &&
          ["/account", "/chat", "/consult", "/diagnosis/partner-mind"].includes(
            path,
          )
        )
          await page.screenshot({
            path: out + `/page-${path.replaceAll("/", "_")}-${width}.png`,
          });
        report.visits.push({
          round,
          width,
          height: page.viewportSize().height,
          path,
          menu: width < 1000,
          wheel: scrolled,
          disclosure: !!(await summary.count()),
          footerAndBack: true,
          text200: round === 2,
        });
        if (report.visits.length % 14 === 0) {
          await health(`visit-${report.visits.length}`);
          console.log("Visits", report.visits.length);
        }
      }
    }
  }
  for (const mode of [
    "empty",
    "free",
    "plus",
    "scheduled",
    "canceled",
    "anonymous",
    "unsaved",
  ]) {
    await scenario(mode);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/account", { waitUntil: "networkidle" });
    if (mode === "empty") {
      await expect(page.locator("h1")).toHaveText("いま、気になることから。");
      await expect(page.locator(".account-continue h2")).toHaveText(
        "いまの気持ちを、言葉に。",
      );
    } else if (mode !== "anonymous") {
      await expect(page.locator("h1")).toHaveText("前の話の、その続きから。");
    }
    await overflow(mode);
    await menu();
    await page.screenshot({
      path: out + `/state-${mode}-390.png`,
      fullPage: true,
    });
    report.states.push({
      mode,
      heading: await page.locator("h1").innerText(),
      pass: true,
    });
  }
  // Keep this same browser context/cache alive across normal stops and restarts.
  for (let i = 0; i < 2; i++) {
    const before = await health(`restart-${i}-before`);
    await assert.rejects(() => start(directory), { code: "EADDRINUSE" });
    await stop(directory);
    assert.throws(() => process.kill(before.pid, 0), { code: "ESRCH" });
    const after = await start(directory);
    assert.notEqual(before.pid, after.pid);
    await scenario("free");
    await page.goto(base + "/chat", { waitUntil: "networkidle" });
    await menu();
    const input = page.locator("#trial-text");
    await input.fill("再起動後の合成相談です。");
    await expect(page.locator(".p6-composer-actions")).toContainText(
      `合計${"再起動後の合成相談です。".length}/800`,
    );
    await page.locator('.p6-check input[type="checkbox"]').check();
    await page
      .getByRole("button", { name: "登録なしで試す", exact: true })
      .click();
    await expect(page.locator(".p6-trial-complete")).toBeVisible();
    await page
      .getByRole("button", { name: "文面だけをコピー", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("文面だけをコピーしました", { exact: false }),
    ).toBeVisible();
    await page.goto(base + "/diagnosis/partner-mind?resume=sample-draft", {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: "保存して次へ", exact: true })
      .click();
    await expect(page.locator("#question-error")).toBeVisible();
    const option = page
      .locator('main input[type="radio"], main input[type="checkbox"]')
      .first();
    await option.check();
    await page
      .getByRole("button", { name: "保存して次へ", exact: true })
      .click();
    await expect(page.locator("#question-error")).toBeHidden();
    await page.screenshot({ path: out + `/restart-${i}-diagnosis.png` });
    report.restarts.push({
      beforePid: before.pid,
      afterPid: after.pid,
      oldExited: true,
      cachedContextMenuInputDiagnosisSendCopy: true,
      portCollisionRejected: true,
    });
  }
  await health("end");
  assert.deepEqual(report.errors, []);
  assert.equal(report.external, 0);
} finally {
  report.ended = new Date().toISOString();
  report.durationSeconds =
    (Date.parse(report.ended) - Date.parse(report.started)) / 1000;
  await fs.writeFile(
    out + "/runtime-results.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
