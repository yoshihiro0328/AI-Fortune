// Local synthetic interaction evidence; all non-loopback requests blocked.
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
await fs.mkdir(out, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [320, 390, 1280, 1440, 1920]) {
    const c = await b.newContext({ viewport: { width, height: 720 } });
    c.setDefaultTimeout(15000);
    c.setDefaultNavigationTimeout(60000);
    let external = 0;
    await c.route("**/*", (r) =>
      new URL(r.request().url()).origin === base
        ? r.continue()
        : (external++, r.abort()),
    );
    const p = await c.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.name));
    const go = async (path) => {
      await p.goto(base + path, { waitUntil: "networkidle" });
    };
    const reset = () =>
      c.request.post(base + "/__review/scenario", {
        maxRedirects: 0,
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=free",
      });
    const overflow = async () =>
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    const wheelPage = async (selector, delta = 180) => {
      await p.evaluate(() => scrollTo(0, 0));
      const el = p.locator(selector);
      await el.scrollIntoViewIfNeeded();
      await el.hover();
      const y = await p.evaluate(() => scrollY);
      await p.mouse.wheel(0, delta);
      await p.waitForTimeout(300);
      assert.ok(
        (await p.evaluate(() => scrollY)) > y,
        selector + " wheel " + width,
      );
    };
    await reset();
    await go("/chat?topic=reply");
    const input = p.locator("#trial-text");
    await input.waitFor();
    const box = await input.boundingBox();
    if (width >= 1280)
      assert.ok(
        box.y + box.height <= 720,
        "initial textarea visible " + JSON.stringify(box),
      );
    await p.screenshot({ path: `${out}/chat-${width}.png`, fullPage: true });
    await wheelPage(".p6-chat-heading h1");
    await wheelPage(".p6-conversation");
    await wheelPage('.p6-composer label[for="trial-text"]');
    await input.fill("【合成】消さない下書き");
    for (const purpose of ["reply", "review", "organize", ""]) {
      await p.getByLabel("今回、相談したいこと（任意）").selectOption(purpose);
      await expect(input).toHaveValue("【合成】消さない下書き");
      if (purpose === "review")
        await expect(input).toHaveAttribute("placeholder", /急かす/);
      if (purpose === "organize")
        await expect(input).toHaveAttribute("placeholder", /気持ちを整理/);
    }
    await p.locator(".chat-extra summary").first().focus();
    await p.keyboard.press("Enter");
    await expect(p.locator(".chat-extra")).toHaveAttribute("open", "");
    await input.fill("【合成】長文の下書き\n".repeat(50));
    await input.scrollIntoViewIfNeeded();
    await input.hover();
    await input.evaluate((e) => (e.scrollTop = 0));
    await p.mouse.wheel(0, 120);
    await p.waitForTimeout(250);
    assert.ok(
      (await input.evaluate((e) => e.scrollTop)) > 0,
      "textarea native scroll",
    );
    await p.locator(".chat-extra summary").first().click();
    await overflow();
    await go("/consult?thread=sample-thread");
    await p.locator("#chat-text").waitFor();
    await p.locator("#chat-text").fill("【合成】Aの保持する下書き");
    await p.getByLabel("今回、相談したいこと（任意）").selectOption("review");
    await expect(p.locator("#chat-text")).toHaveValue(
      "【合成】Aの保持する下書き",
    );
    const history = p.locator(".chat-messages");
    await history.scrollIntoViewIfNeeded();
    await history.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await history.hover();
    await p.waitForTimeout(300);
    let y = await p.evaluate(() => scrollY);
    await p.mouse.wheel(0, 200);
    await p.waitForTimeout(300);
    await p.mouse.wheel(0, 200);
    await p.waitForTimeout(300);
    assert.ok((await p.evaluate(() => scrollY)) > y, "history bottom chains");
    await history.scrollIntoViewIfNeeded();
    await history.evaluate((e) => (e.scrollTop = 0));
    await p.evaluate(() => scrollBy(0, 100));
    await history.hover();
    y = await p.evaluate(() => scrollY);
    await p.mouse.wheel(0, -100);
    await p.waitForTimeout(300);
    await p.mouse.wheel(0, -100);
    await p.waitForTimeout(300);
    assert.ok((await p.evaluate(() => scrollY)) < y, "history top chains");
    await p.locator(".change-disclosure summary").focus();
    await p.keyboard.press("Enter");
    await p
      .getByRole("button", { name: "まだ何もしていない", exact: true })
      .click();
    await expect(p.locator("#chat-text")).toHaveValue(
      /Aの保持する下書き[\s\S]*まだ何もしていない/,
    );
    await overflow();
    for (const [name, path] of [
      ["history", "/consult?thread=sample-thread"],
      ["result", "/result/sample-result"],
      ["report", "/report/sample-result"],
      ["account", "/account"],
      ["article", "/guides/slow-replies"],
      ["plans", "/plans"],
      ["help", "/help"],
      ["diagnosis", "/diagnosis/partner-mind"],
    ]) {
      await go(path);
      await overflow();
      if (name === "account")
        await expect(p.locator(".diagnosis-row-title").first()).toContainText(
          "サンプル",
        );
      if (name === "article")
        await expect(
          p.getByRole("link", {
            name: "自由な文章で相談をはじめる",
            exact: true,
          }),
        ).toHaveAttribute("href", "/chat?topic=reply");
      if (name === "plans")
        assert.equal(
          await p.getByText("返信作成：利用できます", { exact: true }).count(),
          2,
        );
      if ([390, 1440].includes(width))
        await p.screenshot({
          path: `${out}/${name}-${width}.png`,
          fullPage: true,
        });
      // True text-size enlargement, including px-based controls; not just viewport resizing.
      await p.evaluate(() => {
        const els = [...document.querySelectorAll("main,main *")];
        const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
        els.forEach((e, i) => (e.style.fontSize = sizes[i] * 2 + "px"));
      });
      await overflow();
      results.push({ width, page: name, text200: true, overflow: false });
    }
    assert.deepEqual(errors, []);
    assert.equal(external, 0);
    results.push({
      width,
      initialInput: box.y,
      wheel: true,
      textarea: true,
      purposeDraft: true,
    });
    console.log("verified", width);
    await c.close();
  }
} finally {
  await b.close();
  await fs.writeFile(
    out + "/interactions.json",
    JSON.stringify(results, null, 2),
  );
}
