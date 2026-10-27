// Actual Chrome, synthetic loopback server only. No connected account or real clipboard.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out =
    process.env.LOCAL_REVIEW_SCREENSHOTS ||
    "/private/tmp/yorisoi-journey-review";
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    const c = await browser.newContext({ viewport: { width, height } });
    const errors = [];
    let external = 0;
    await c.route("**/*", (r) =>
      new URL(r.request().url()).origin === base
        ? r.continue()
        : (external++, r.abort()),
    );
    await c.addInitScript(() => {
      window.__copies = [];
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (text) => window.__copies.push(text) },
        configurable: true,
      });
    });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    const reset = async (mode) => {
      await c.request.post(base + "/__review/scenario", {
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=" + mode,
      });
    };
    const go = async (path) => {
      const r = await p.goto(base + path, { waitUntil: "networkidle" });
      assert.equal(r.status(), 200);
    };
    const visible = async () =>
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    const picker = async () => {
      const b = p.getByRole("button", {
        name: "相手・相談履歴を選ぶ",
        exact: true,
      });
      if (await b.isVisible()) await b.click();
    };
    const subject = async (letter) => {
      await picker();
      await p
        .locator(".subject-tab")
        .filter({ hasText: "サンプル" + letter + "さん" })
        .click();
      await p.waitForFunction(
        () => !document.querySelector("#chat-text")?.disabled,
      );
    };
    await reset("free");
    await go("/");
    await visible();
    assert.match(await p.locator(".home-conditions").innerText(), /月3往復/);
    assert.match(
      await p.locator(".home-conditions").innerText(),
      /登録なしのお試し相談/,
    );
    await p.screenshot({ path: `${out}/home-${width}.png` });
    await p.getByRole("link", { name: "返信・LINE", exact: true }).click();
    await p.waitForURL("**/chat?topic=reply");
    await go("/consult?topic=reply");
    await p.locator("#chat-text").waitFor();
    await p.getByText("相談のテーマ：返信・LINE").waitFor();
    await p.locator("#chat-text").fill("Aだけの書きかけ");
    await subject("B");
    assert.equal(await p.locator("#chat-text").inputValue(), "");
    await p.locator("#chat-text").fill("Bだけの書きかけ");
    await subject("A");
    assert.equal(await p.locator("#chat-text").inputValue(), "Aだけの書きかけ");
    await subject("C");
    assert.equal(await p.locator("#chat-text").inputValue(), "");
    await subject("A");
    assert.equal(await p.locator("#chat-text").inputValue(), "Aだけの書きかけ");
    await p
      .getByRole("button", { name: "入力欄を広げる", exact: true })
      .click();
    assert.equal(await p.locator("#chat-text").getAttribute("rows"), "12");
    await p
      .getByRole("button", { name: "入力欄を小さくする", exact: true })
      .click();
    const sends = [];
    let fail = true;
    await p.route("**/api/consultations/sample-thread/send", async (r) => {
      sends.push(r.request().postDataJSON());
      if (fail) {
        fail = false;
        await r.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "合成の送信失敗" }),
        });
      } else await r.continue();
    });
    await p.getByRole("button", { name: "相談を送る", exact: true }).click();
    await p.getByRole("alert").filter({ hasText: "合成の送信失敗" }).waitFor();
    assert.equal(await p.locator("#chat-text").inputValue(), "Aだけの書きかけ");
    await subject("B");
    assert.equal(await p.locator("#chat-text").inputValue(), "Bだけの書きかけ");
    await subject("A");
    await p
      .getByRole("button", { name: "同じ内容を再送する", exact: true })
      .click();
    await p.waitForFunction(
      () => document.querySelector("#chat-text")?.value === "",
    );
    assert.equal(sends.length, 2);
    assert.equal(sends[0].requestId, sends[1].requestId);
    await subject("B");
    assert.equal(await p.locator("#chat-text").inputValue(), "Bだけの書きかけ");
    await picker();
    await p.locator("#history-search").fill("連絡");
    await p.getByRole("button", { name: "検索する", exact: true }).click();
    await p.getByRole("region", { name: "検索結果" }).waitFor();
    await p
      .getByRole("region", { name: "検索結果" })
      .getByRole("button")
      .first()
      .click();
    await visible();
    await p.screenshot({ path: `${out}/consult-${width}.png`, fullPage: true });
    // Logout in a second tab clears in-memory drafts and private results immediately.
    await p.locator("#chat-text").fill("ログアウトで消える本文");
    const other = await c.newPage();
    await other.goto(base + "/account", { waitUntil: "networkidle" });
    await other
      .getByRole("button", { name: "ログアウト", exact: true })
      .click();
    await p
      .getByRole("link", { name: "ログイン・無料登録", exact: true })
      .waitFor();
    assert.equal(await p.locator("#chat-text").count(), 0);
    assert.equal(await p.getByText("ログアウトで消える本文").count(), 0);
    await other.close();
    await reset("free");
    await go("/result/sample-result");
    await p.getByText("保存済み —", { exact: false }).waitFor();
    assert.equal(
      await p
        .locator(".save-note")
        .getByText("Cookie", { exact: false })
        .count(),
      0,
    );
    await p
      .getByRole("link", { name: "この診断について相談する", exact: true })
      .click();
    await p.waitForURL("**/consult?thread=sample-thread-b");
    await p
      .locator(".chat-panel h2")
      .filter({ hasText: "サンプルBさん" })
      .waitFor();
    assert.equal(await p.locator("#chat-text").inputValue(), "");
    await reset("unsaved");
    await go("/report/sample-result");
    await p
      .getByRole("button", { name: "この診断を保存する", exact: true })
      .click();
    await p.getByText("保存済み —", { exact: false }).waitFor();
    await p.locator("#report-toc").waitFor();
    assert.equal(await p.locator("#report-toc a").count(), 13);
    assert.equal(await p.locator("#report-toc details[open]").count(), 0);
    for (const s of await p.locator("#report-toc summary").all()) {
      await s.focus();
      await p.keyboard.press("Enter");
    }
    await p.locator('#report-toc a[href="#report-item-9"]').focus();
    await p.keyboard.press("Enter");
    await p.waitForURL("**#report-item-9");
    assert.equal(
      await p.evaluate(() => document.activeElement.id),
      "report-item-9",
    );
    for (const d of await p.locator(".message-draft").all()) {
      const expected = (await d.locator(".message").innerText()).trim();
      await d
        .getByRole("button", { name: "文面だけをコピー", exact: true })
        .click();
      assert.equal(await p.evaluate(() => window.__copies.at(-1)), expected);
    }
    await p.goto(base + "/report/sample-result", { waitUntil: "networkidle" });
    await visible();
    await p.screenshot({ path: `${out}/report-${width}.png` });
    await go("/report-sample");
    await visible();
    assert.equal(
      await p
        .getByRole("button", { name: "文面だけをコピー", exact: true })
        .count(),
      3,
    );
    await p.screenshot({ path: `${out}/sample-${width}.png`, fullPage: true });
    await go("/help");
    for (const s of await p.locator(".help-section summary").all()) {
      await s.focus();
      await p.keyboard.press("Enter");
      assert.equal(await s.evaluate((el) => el.parentElement.open), true);
    }
    await visible();
    await go("/consult");
    await p.locator("#chat-text").waitFor();
    await p
      .getByText("日付付きの出来事（自分で記録）", { exact: true })
      .click();
    await p.locator("#event-date").fill("2026-10-27");
    await p.locator("#event-text").fill("合成の手入力記録");
    await p.getByRole("button", { name: "出来事を保存", exact: true }).click();
    await p.getByText("合成の手入力記録", { exact: true }).waitFor();
    await p.getByRole("button", { name: "編集", exact: true }).click();
    await p.locator("#event-text").fill("合成の修正済み記録");
    await p.getByRole("button", { name: "変更を保存", exact: true }).click();
    await p.getByText("合成の修正済み記録", { exact: true }).waitFor();
    p.once("dialog", (d) => d.accept());
    await p.getByRole("button", { name: "削除", exact: true }).click();
    await p
      .getByText("日付付きの出来事はまだありません。", { exact: true })
      .waitFor();
    // Long replies switch exact source excerpt/full text, with no generated summary.
    const longAnswer = "冒頭の原文です。\\n\\n" + "続く原文です。".repeat(100);
    await p.route("**/api/consultations?thread=sample-thread", async (r) => {
      const res = await r.fetch();
      const data = await res.json();
      data.turns[0].assistant_text = longAnswer.replaceAll("\\n", "\n");
      await r.fulfill({ response: res, json: data });
    });
    await go("/consult?thread=sample-thread");
    await p
      .getByRole("button", { name: "回答の全文を読む", exact: true })
      .click();
    await p
      .getByRole("button", { name: "冒頭だけに戻す", exact: true })
      .waitFor();
    assert.match(
      await p.locator(".consult-answer-text").first().innerText(),
      /続く原文です/,
    );
    await p
      .getByRole("button", { name: "冒頭だけに戻す", exact: true })
      .click();
    assert.doesNotMatch(
      await p.locator(".consult-answer-text").first().innerText(),
      /続く原文です/,
    );
    // A reply completing after logout cannot repopulate the old user's conversation.
    let release, startedResolve;
    const started = new Promise((r) => (startedResolve = r)),
      held = new Promise((r) => (release = r));
    await p.route("**/api/consultations/sample-thread/send", async (r) => {
      startedResolve();
      await held;
      await r.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"ok":true}',
      });
    });
    await p.locator("#chat-text").fill("遅延回答の隔離テスト");
    await p.getByRole("button", { name: "相談を送る", exact: true }).click();
    await started;
    const logout = await c.newPage();
    await logout.goto(base + "/account", { waitUntil: "networkidle" });
    await logout
      .getByRole("button", { name: "ログアウト", exact: true })
      .click();
    await p
      .getByRole("link", { name: "ログイン・無料登録", exact: true })
      .waitFor();
    release();
    await p.waitForTimeout(200);
    assert.equal(await p.locator("#chat-text").count(), 0);
    assert.equal(await p.locator(".chat-exchange").count(), 0);
    await logout.close();
    assert.deepEqual(errors, []);
    assert.equal(external, 0);
    results.push({
      width,
      height,
      drafts: true,
      retrySameId: true,
      logoutIsolation: true,
      savedState: true,
      diagnosisMapping: true,
      tocKeyboard: true,
      copy: true,
      eventsSynthetic: true,
      externalRequests: external,
    });
    await c.close();
  }
  await fs.writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
