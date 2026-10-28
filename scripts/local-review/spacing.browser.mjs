// Local synthetic evidence only; never connects to a user account or external service.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out = "/private/tmp/yorisoi-spacing-review";
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
await fs.mkdir(out + "/verified", { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
const pages = [
  ["home", "/"],
  ["account", "/account"],
  ["chat", "/chat"],
  ["history", "/consult?thread=sample-thread"],
  ["diagnosis", "/diagnosis/partner-mind"],
  ["result", "/result/sample-result"],
  ["report", "/report/sample-result"],
  ["plans", "/plans"],
  ["guides", "/guides"],
  ["article", "/guides/slow-replies"],
  ["help", "/help"],
  ["privacy", "/legal/privacy"],
];
try {
  for (const width of [320, 390, 1280, 1440, 1920]) {
    const c = await b.newContext({ viewport: { width, height: 960 } });
    c.setDefaultTimeout(20000);
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
        maxRedirects: 0,
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=" + mode,
      });
    const overflow = async (label) =>
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        label + " width " + width,
      );
    await reset("free");
    for (const [name, path] of pages) {
      console.log(width, name);
      await p.goto(base + path, { waitUntil: "networkidle" });
      await p.locator("main").waitFor();
      if (name === "history") {
        await p.locator(".organize summary").click();
        const input = p.locator("#chat-text");
        await input.fill("【合成】長い相談文。".repeat(30));
        await input.focus();
        const a = await input.boundingBox(),
          row = await p.locator(".composer-actions").boundingBox();
        assert.ok(row.y >= a.y + a.height + 15);
        assert.equal(await p.locator(".safety-action a").count(), 1);
        for (const [field, button, next] of [
          ["#rename-subject", "呼び名を変更", "#thread-title"],
          ["#thread-title", "タイトルを保存", "#move-subject"],
        ]) {
          const f = await p.locator(field).boundingBox(),
            btn = await p
              .getByRole("button", { name: button, exact: true })
              .boundingBox(),
            n = await p.locator(next).boundingBox();
          assert.ok(btn.y >= f.y + f.height + 15);
          assert.ok(n.y >= btn.y + btn.height + 23);
        }
      }
      if (name === "chat") {
        const a = await p.locator("#trial-text").boundingBox(),
          row = await p.locator(".composer-actions").boundingBox();
        assert.ok(row.y >= a.y + a.height + 15);
        await p.locator("#trial-text").fill("【合成】入力中の文章");
        await p.locator("#trial-text").focus();
        assert.equal(await p.locator(".destructive-actions").count(), 1);
      }
      if (name === "account") {
        const primary = p.getByRole("link", {
          name: "詳細レポートを読む",
          exact: true,
        });
        await expect(primary).toHaveClass("button");
        assert.equal(
          await primary.evaluate((e) => getComputedStyle(e).backgroundColor),
          "rgb(49, 86, 70)",
        );
        const d = await p
          .locator(".account-settings .destructive-actions")
          .evaluate((e) => ({
            padding: getComputedStyle(e).paddingTop,
            margin: getComputedStyle(e).marginTop,
          }));
        assert.deepEqual(d, { padding: "32px", margin: "32px" });
      }
      if (name === "privacy") {
        assert.equal(await p.locator(".privacy-summary dt").count(), 5);
        await expect(p.locator(".privacy-summary")).toContainText(
          "本番稼働は確認待ち",
        );
        await expect(p.locator("main")).not.toContainText("【未設定】データ別");
      }
      await overflow(name);
      if (
        ["account", "chat", "history", "privacy"].includes(name) &&
        [390, 1440].includes(width)
      ) {
        await p.screenshot({
          path: `${out}/verified/${name}-${width}.png`,
          fullPage: true,
        });
        const target =
          name === "account"
            ? ".account-settings"
            : name === "history"
              ? ".organize"
              : name === "chat"
                ? ".p6-composer-dock"
                : ".privacy-summary";
        await p
          .locator(target)
          .screenshot({ path: `${out}/verified/${name}-detail-${width}.png` });
      }
      results.push({ width, page: name, overflow: false });
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
      await p.goto(base + "/account", { waitUntil: "networkidle" });
      await overflow("account " + mode);
      results.push({ width, mode, overflow: false });
    }
    // Double actual text sizes, including sizes set in px. This is text enlargement, not device emulation.
    await reset("free");
    for (const path of ["/account", "/chat", "/consult?thread=sample-thread"]) {
      await p.goto(base + path, { waitUntil: "networkidle" });
      if (path.includes("consult"))
        await p.locator(".organize summary").click();
      await p.evaluate(() => {
        const values = [
          ...document.querySelectorAll("main *,nav *,footer *"),
        ].map((e) => [e, parseFloat(getComputedStyle(e).fontSize)]);
        for (const [e, size] of values) e.style.fontSize = size * 2 + "px";
      });
      await overflow("200% " + path);
      results.push({ width, page: path, textScale: 2, overflow: false });
    }
    assert.equal(external, 0);
    assert.deepEqual(errors, []);
    await c.close();
  }
} finally {
  await b.close();
}
await fs.writeFile(
  out + "/verified/results.json",
  JSON.stringify(results, null, 2),
);
console.log("spacing checks", results.length);
