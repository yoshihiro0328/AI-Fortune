// Synthetic fixtures in isolated Chrome; no user profile, real clipboard, or external calls.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out = "/private/tmp/yorisoi-clarity-review";
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
  for (const width of [1440, 390]) {
    const c = await b.newContext({ viewport: { width, height: 960 } });
    c.setDefaultTimeout(15000);
    let external = 0;
    const errors = [];
    await c.route("**/*", (r) =>
      new URL(r.request().url()).origin === base
        ? r.continue()
        : (external++, r.abort()),
    );
    await c.addInitScript(() => {
      window.__copies = [];
      window.__copyFail = false;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (t) => {
            if (window.__copyFail) throw Error("synthetic clipboard denial");
            window.__copies.push(t);
          },
        },
        configurable: true,
      });
    });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    const reset = async (mode = "free") =>
      c.request.post(base + "/__review/scenario", {
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=" + mode,
      });
    const go = async (path) => {
      console.log(width, path);
      assert.equal(
        (await p.goto(base + path, { waitUntil: "networkidle" })).status(),
        200,
      );
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    };
    await reset();
    await go("/");
    const cards = p.locator(".home-return-cards > a");
    assert.equal(await cards.count(), 2);
    assert.equal(await cards.locator("a").count(), 0);
    const boxes = await cards.evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
    assert.ok(Math.abs(boxes[0].width - boxes[1].width) < 1);
    assert.ok(Math.abs(boxes[0].height - boxes[1].height) < 1);
    assert.equal(width > 700, Math.abs(boxes[0].y - boxes[1].y) < 1);
    await cards.first().scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/home-links-${width}.png` });
    await cards.first().focus();
    await p.keyboard.press("Enter");
    await p.waitForURL(base + "/guides");
    await go("/consult");
    await p.locator("#chat-text").fill("自分で書いた断りの文を確認したい。");
    await p.getByLabel("今回、相談したいこと（任意）").selectOption("review");
    assert.equal(
      await p.locator("#chat-text").inputValue(),
      "自分で書いた断りの文を確認したい。",
    );
    const sent = [];
    p.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/send"))
        sent.push(r.postDataJSON());
    });
    await p.getByRole("button", { name: "返信が来た", exact: true }).click();
    assert.equal(sent.length, 0);
    assert.match(await p.locator("#chat-text").inputValue(), /返信が来た/);
    await p.getByRole("button", { name: "相談を送る", exact: true }).click();
    await p
      .getByRole("button", { name: "文面だけをコピー", exact: true })
      .last()
      .waitFor();
    assert.match(sent[0].text, /相談の目的：自分で書いた文を見てほしい/);
    await p
      .getByRole("button", { name: "文面だけをコピー", exact: true })
      .last()
      .click();
    let copies = await p.evaluate(() => window.__copies);
    assert.equal(
      copies.at(-1),
      "少し話せる時間はある？ 難しければ断って大丈夫だよ。",
    );
    await p.evaluate(() => (window.__copyFail = true));
    await p
      .getByRole("button", { name: "文面だけをコピー", exact: true })
      .last()
      .click();
    assert.ok(
      await p
        .getByText("コピーできませんでした。文面を選択してコピーしてください。")
        .isVisible(),
    );
    await p.evaluate(() => (window.__copyFail = false));
    await p.locator(".assistant-message").last().scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/consult-reply-${width}.png` });
    await reset();
    await go("/chat");
    await p.locator("#trial-text").fill("「最近どう？」に元気だと返信したい");
    await p.getByLabel("今回、相談したいこと（任意）").selectOption("reply");
    await p.locator(".p6-check input").first().check();
    await p.getByRole("button", { name: "登録なしで試す" }).click();
    await p
      .getByRole("button", { name: "文面だけをコピー", exact: true })
      .waitFor();
    await p
      .getByRole("button", { name: "文面だけをコピー", exact: true })
      .click();
    copies = await p.evaluate(() => window.__copies);
    assert.equal(copies.at(-1), "元気だよ。そちらは最近どう？");
    await go("/result/sample-result");
    const headings = await p.locator("h2").allTextContents();
    assert.ok(headings.indexOf("現在の状況") < headings.indexOf("良い兆候"));
    assert.ok(
      headings.indexOf("まだ分からないこと") <
        headings.indexOf("まず、できること"),
    );
    assert.ok(
      headings.indexOf("まず、できること") <
        headings.indexOf("回答から整理した3つの指標"),
    );
    for (const path of [
      "/report/sample-result",
      "/account",
      "/plans",
      "/help",
      "/diagnosis/partner-mind?new=1",
    ])
      await go(path);
    assert.deepEqual(errors, []);
    assert.equal(external, 0);
    results.push({
      width,
      links: true,
      purposeToRequest: true,
      copy: true,
      changeDraftOnly: true,
      resultOrder: true,
      external,
    });
    await c.close();
  }
  console.log(JSON.stringify(results));
  await fs.writeFile(out + "/results.json", JSON.stringify(results));
} finally {
  await b.close();
}
