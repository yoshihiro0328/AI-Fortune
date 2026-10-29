// End-to-end initialization checks against the isolated synthetic server only.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out = process.env.LOCAL_REVIEW_SCREENSHOTS;
assert(out);
await fs.mkdir(out, { recursive: true });
const h = await fetch(base + "/__review/health").then((r) => r.json());
assert(h.synthetic && !h.external && h.runtime === "production-build");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [320, 390, 844, 1440]) {
    const c = await browser.newContext({
      viewport: { width, height: width === 844 ? 390 : 900 },
    });
    let gate = "",
      release,
      held = false,
      fail = false,
      external = 0;
    await c.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== base) {
        external++;
        return route.abort();
      }
      if (u.pathname === gate && route.request().method() === "GET") {
        held = true;
        await new Promise((r) => (release = r));
        if (fail)
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "合成の一時的な読み込み失敗です。" }),
          });
      }
      return route.continue();
    });
    const p = await c.newPage();
    async function reset(mode) {
      await c.request.post(base + "/__review/scenario", {
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=" + mode,
      });
    }
    await reset("empty");
    gate = "/api/consultations";
    await p.goto(base + "/account", { waitUntil: "domcontentloaded" });
    await expect.poll(() => held).toBe(true);
    await expect(
      p.getByText("相談情報を読み込んでいます…", { exact: true }),
    ).toBeVisible();
    await expect(p.locator("h1")).toHaveText("あなたの相談と記録");
    await p.screenshot({ path: out + `/loading-${width}.png` });
    gate = "";
    release();
    await expect(p.locator("h1")).toHaveText("いま、気になることから。");
    await p.getByRole("link", { name: "相談をはじめる", exact: true }).click();
    await expect(p.locator(".consult-heading")).toContainText(
      "いま気になっていることを",
    );
    await p.getByRole("button", { name: "相談を書く", exact: true }).click();
    await expect(p.locator("#nickname")).toBeFocused();
    // Failed initialization offers an explicit error; a new load recovers without a write retry.
    gate = "/api/consultations";
    held = false;
    fail = true;
    await p.goto(base + "/consult", { waitUntil: "domcontentloaded" });
    await expect.poll(() => held).toBe(true);
    release();
    await expect(
      p.getByText("合成の一時的な読み込み失敗です。", { exact: true }),
    ).toBeVisible();
    gate = "";
    fail = false;
    await reset("free");
    await p.reload({ waitUntil: "networkidle" });
    await expect(p.locator(".current-subject")).toHaveText(
      "相談相手を選んでください",
    );
    // All answers are synthetic; the endpoint is a local fixture, not AI generation.
    await p.goto(base + "/diagnosis/partner-mind?resume=sample-draft", {
      waitUntil: "networkidle",
    });
    let answered = 0;
    while (
      new URL(p.url()).pathname.startsWith("/diagnosis") &&
      answered < 12
    ) {
      const title = p.locator("#question-title");
      await expect(title).toBeVisible();
      const old = await title.innerText();
      const radio = p.locator('fieldset input[type="radio"]').first();
      if (await radio.count()) await radio.check();
      else
        await p
          .locator("fieldset textarea, fieldset input")
          .first()
          .fill("架空の状況を整理するための合成回答です。");
      await p
        .getByRole("button", { name: "保存して次へ", exact: true })
        .click();
      answered++;
      await expect
        .poll(
          async () =>
            new URL(p.url()).pathname.startsWith("/result") ||
            (await title.innerText().catch(() => "")) !== old,
        )
        .toBe(true);
      if (new URL(p.url()).pathname.startsWith("/result")) break;
    }
    await p.waitForURL(base + "/result/sample-draft");
    await expect(
      p.getByRole("heading", { name: "現在の状況", exact: true }),
    ).toBeVisible();
    await p.screenshot({ path: out + `/diagnosis-completed-${width}.png` });
    assert.equal(external, 0);
    results.push({
      width,
      height: width === 844 ? 390 : 900,
      loadingThenReady: true,
      firstHistoryGuidance: true,
      failedLoadThenReload: true,
      diagnosisAnswered: answered,
      syntheticResult: true,
      external,
    });
    await c.close();
    console.log("State flow", width, "passed");
  }
} finally {
  await fs.writeFile(
    out + "/state-results.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
}
