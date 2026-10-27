// Only the isolated local-review server and synthetic fixtures; never use connected accounts.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out = process.env.LOCAL_REVIEW_SCREENSHOTS || "/tmp/yorisoi-subpages-review",
  results = [];
const health = await fetch(base + "/__review/health").then((r) => r.json());
assert.equal(health.synthetic, true);
assert.equal(health.external, false);
assert.equal(health.ready, true);
await fs.mkdir(out, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [width, height] of [
    [1280, 900],
    [1440, 1000],
    [1920, 1080],
    [390, 844],
    [320, 740],
  ]) {
    const c = await b.newContext({ viewport: { width, height } });
    const errors = [],
      external = [];
    await c.route("**/*", (r) =>
      new URL(r.request().url()).origin === base
        ? r.continue()
        : (external.push("blocked"), r.abort()),
    );
    await c.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (text) => window.__copied.push(text) },
        configurable: true,
      });
    });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    const go = async (path) => {
      const res = await p.goto(base + path, { waitUntil: "networkidle" });
      assert.equal(res.status(), 200);
      await p.waitForTimeout(100);
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `overflow ${path} ${width}`,
      );
    };
    const reset = async (mode) => {
      await c.request.post(base + "/__review/scenario", {
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=" + mode,
      });
    };
    await reset("free");
    await go("/report/sample-result");
    await p.locator("#report-toc").waitFor();
    assert.equal(await p.locator("#report-toc a").count(), 13);
    await p.screenshot({ path: `${out}/report-${width}.png`, fullPage: true });
    await p.screenshot({ path: `${out}/report-top-${width}.png` });
    for (const summary of await p.locator("#report-toc summary").all()) {
      await summary.focus();
      await p.keyboard.press("Enter");
    }
    for (let n = 1; n <= 13; n++) {
      const link = p.locator(`#report-toc a[href="#report-item-${n}"]`);
      await link.focus();
      await p.keyboard.press("Enter");
      await p.waitForURL("**#report-item-" + n);
      assert.equal(
        await p.evaluate(() => document.activeElement.id),
        "report-item-" + n,
      );
    }
    await p.locator(".back-to-toc").last().click();
    await p.waitForURL("**#report-toc");
    await p.locator('#report-toc a[href="#report-item-9"]').click();
    for (const draft of await p.locator(".message-draft").all()) {
      const expected = (await draft.locator(".message").innerText()).trim();
      await draft
        .getByRole("button", { name: "文面だけをコピー", exact: true })
        .focus();
      await p.keyboard.press("Enter");
      assert.equal(await p.evaluate(() => window.__copied.at(-1)), expected);
      assert.ok(
        !(await p.evaluate(() => window.__copied.at(-1))).includes("補足"),
      );
    }
    await p.locator("#report-item-9").scrollIntoViewIfNeeded();
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await p.screenshot({ path: `${out}/report-messages-${width}.png` });
    await p
      .getByRole("link", { name: "無料診断結果に戻る", exact: true })
      .click();
    await p.waitForURL(base + "/result/sample-result");
    await p.getByRole("heading", { name: "購入済みの詳細レポート" }).waitFor();
    assert.equal(
      await p.getByRole("button", { name: "詳細レポートの購入へ進む" }).count(),
      0,
    );
    assert.equal(await p.locator(".price").count(), 0);
    const order = await p.locator("main h2").allTextContents();
    assert.ok(
      order.indexOf("まだ分からないこと") < order.indexOf("まず、できること"),
    );
    assert.ok(
      order.indexOf("まだ分からないこと") <
        order.indexOf("回答から整理した3つの指標"),
    );
    await p.screenshot({ path: `${out}/result-${width}.png`, fullPage: true });
    for (const mode of ["free", "plus", "scheduled", "canceled", "empty"]) {
      await reset(mode);
      await go("/account");
      await p.locator("#current-plan").waitFor();
      const text = await p.locator("main").innerText();
      if (mode === "plus")
        assert.ok(text.includes("契約中") && text.includes("29往復"));
      if (mode === "scheduled") {
        assert.ok(text.includes("解約予約済み"));
        assert.equal(
          await p
            .getByRole("button", { name: "次回の自動更新を停止する" })
            .count(),
          0,
        );
      }
      if (mode === "canceled")
        assert.ok(text.includes("解約済み") && text.includes("無料プラン"));
      if (mode === "empty") {
        assert.ok(
          text.includes("まだ相談履歴はありません") &&
            text.includes("まだ診断はありません"),
        );
        assert.ok(
          await p
            .getByRole("link", { name: "相談をはじめる", exact: true })
            .isVisible(),
        );
      }
      const logout = p.getByRole("button", { name: "ログアウト", exact: true });
      assert.equal(await logout.getAttribute("class"), "text-button");
      assert.ok(
        (await p.locator(".account-continue").boundingBox()).y <
          (await p.locator(".account-plan").boundingBox()).y,
      );
      await p.screenshot({
        path: `${out}/account-${mode}-${width}.png`,
        fullPage: mode === "scheduled" || mode === "empty",
      });
    }
    await reset("free");
    await go("/guides");
    assert.equal(await p.locator(".reading-entry").count(), 8);
    await p.screenshot({ path: `${out}/guides-${width}.png`, fullPage: true });
    await p.locator(".reading-open").first().focus();
    await p.keyboard.press("Enter");
    await p.waitForURL(base + "/guides/slow-replies");
    assert.equal(await p.locator(".reading-section").count(), 4);
    await p.screenshot({ path: `${out}/article-${width}.png`, fullPage: true });
    await p.getByRole("link", { name: "自由な文章で相談をはじめる" }).click();
    await p.waitForURL(base + "/chat");
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    results.push({
      width,
      height,
      toc: 13,
      copy: "message only, isolated clipboard",
      states: 5,
      navigation: true,
      errors,
      external,
    });
    await c.close();
  }
  // Response-only overrides simulate unpurchased, missing entries, loading and failures. No external services.
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c.route("**/*", (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  const p = await c.newPage();
  await c.route("**/api/diagnoses/sample-result", async (r) => {
    const res = await r.fetch();
    const data = await res.json();
    data.payment_status = "unpaid";
    data.free_report.positive_signals = [];
    data.free_report.attention_signals = [];
    data.free_report.uncertainties = [];
    await r.fulfill({ response: res, json: data });
  });
  await p.goto(base + "/result/sample-result");
  await p
    .getByRole("button", { name: "詳細レポートの購入へ進む", exact: true })
    .waitFor();
  assert.equal(
    await p.getByRole("link", { name: "購入したレポートを見る" }).count(),
    0,
  );
  await p.screenshot({
    path: out + "/result-unpurchased-mobile.png",
    fullPage: true,
  });
  await c.route("**/api/diagnoses/sample-result/report", async (r) => {
    const res = await r.fetch();
    const data = await res.json();
    data.report.distance_reasons = [];
    data.report.seven_day_plan = [];
    data.report.relationship_analysis = "";
    await r.fulfill({ response: res, json: data });
  });
  await p.goto(base + "/report/sample-result");
  await p.locator("#report-toc").waitFor();
  assert.equal(await p.locator("#report-toc a").count(), 13);
  assert.ok(
    (await p
      .getByText("この項目の記載はありません。", { exact: true })
      .count()) >= 3,
  );
  await c.unroute("**/api/diagnoses/sample-result/report");
  await c.route("**/api/diagnoses/sample-result/report", (r) =>
    r.fulfill({ status: 403, json: { error: "合成の読み込みエラー" } }),
  );
  await p.reload();
  await p
    .getByRole("heading", { name: "レポートを表示できませんでした" })
    .waitFor();
  assert.equal(await p.locator("#report-toc").count(), 0);
  await p.screenshot({
    path: out + "/report-error-mobile.png",
    fullPage: true,
  });
  await c.unroute("**/api/diagnoses/sample-result/report");
  await c.route("**/api/diagnoses/sample-result/report", (r) =>
    r.fulfill({ json: { status: "generating", report: null, attempts: 0 } }),
  );
  await p.reload();
  await p.getByRole("heading", { name: "レポートを準備しています" }).waitFor();
  await p.screenshot({
    path: out + "/report-loading-mobile.png",
    fullPage: true,
  });
  await c.route("**/api/auth", (r) =>
    r.fulfill({ status: 500, json: { error: "合成エラー" } }),
  );
  await p.goto(base + "/account");
  await p.locator("main [role=alert]").waitFor();
  assert.ok(
    (await p.locator("main [role=alert]").innerText()).includes(
      "読み込めません",
    ),
  );
  await p.screenshot({
    path: out + "/account-error-mobile.png",
    fullPage: true,
  });
  await c.close();
  await fs.writeFile(
    out + "/results.json",
    JSON.stringify(
      {
        viewports: results,
        edgeCases: {
          unpaid: true,
          emptyFields: true,
          reportError: true,
          reportLoading: true,
          accountError: true,
        },
      },
      null,
      2,
    ),
  );
  console.log("All subpage browser checks passed.");
} finally {
  await b.close();
}
