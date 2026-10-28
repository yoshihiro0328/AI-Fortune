// A delayed synthetic reply must not repaint a draft after an identity-change signal.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out =
    process.env.LOCAL_REVIEW_SCREENSHOTS || "/private/tmp/yorisoi-line-review";
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
const b = await chromium.launch({ channel: "chrome", headless: true });
try {
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c.request.post(base + "/__review/scenario", {
    maxRedirects: 0,
    headers: {
      origin: base,
      "content-type": "application/x-www-form-urlencoded",
    },
    data: "mode=free",
  });
  let release, entered;
  const gate = new Promise((r) => (release = r)),
    started = new Promise((r) => (entered = r));
  await c.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== base) return r.abort();
    if (u.pathname === "/api/trial/turns") {
      entered();
      await gate;
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active: true,
          enabled: true,
          maxLength: 800,
          remaining: 0,
          turn: { status: "ready", answer: "遅れて届いた合成回答" },
        }),
      });
    }
    return r.continue();
  });
  const p = await c.newPage();
  await p.goto(base + "/chat?topic=reply", { waitUntil: "networkidle" });
  await p.locator("#trial-text").fill("切替前の相談文");
  await p.locator(".import-picker>summary").click();
  await p
    .getByRole("button", { name: "合成画像を用意する", exact: true })
    .click();
  await expect(p.locator(".import-count")).toContainText("会話4件", {
    timeout: 125000,
  });
  await p.locator(".p6-check input").first().check();
  await p.getByRole("button", { name: "登録なしで試す", exact: true }).click();
  await started;
  await p.evaluate(() =>
    window.dispatchEvent(new Event("yorisoi-auth-change")),
  );
  release();
  await p.waitForTimeout(300);
  await expect(p.locator("#trial-text")).toHaveValue("");
  await expect(p.locator(".import-count")).toHaveCount(0);
  await expect(p.getByText("遅れて届いた合成回答")).toHaveCount(0);
  await fs.writeFile(
    out + "/privacy-results.json",
    JSON.stringify(
      {
        identityChangeClearsMaterial: true,
        lateResponseIgnored: true,
        synthetic: true,
        external: false,
      },
      null,
      2,
    ),
  );
  console.log("Identity change and delayed response passed");
} finally {
  await b.close();
}
