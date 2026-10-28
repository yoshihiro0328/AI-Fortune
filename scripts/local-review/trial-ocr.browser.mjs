// Synthetic on-device OCR, isolated Chrome, no external calls or real clipboard.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = "http://127.0.0.1:5318";
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
await fs.mkdir("/private/tmp/yorisoi-spacing-review", { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true });
const results = {};
try {
  const c = await b.newContext({ viewport: { width: 390, height: 900 } });
  c.setDefaultTimeout(20000);
  let sent = 0,
    external = 0;
  await c.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== base) {
      external++;
      return r.abort();
    }
    if (r.request().method() === "POST" && u.pathname.includes("/api/trial"))
      sent++;
    return r.continue();
  });
  await c.request.post(base + "/__review/scenario", {
    maxRedirects: 0,
    headers: {
      origin: base,
      "content-type": "application/x-www-form-urlencoded",
    },
    data: "mode=free",
  });
  const p = await c.newPage();
  await p.goto(base + "/chat", { waitUntil: "networkidle", timeout: 60000 });
  await p.locator("#trial-text").fill("保持する下書き");
  const s = p.locator("#screenshot-import");
  await s.locator("summary").focus();
  await p.keyboard.press("Enter");
  await expect(s).toHaveAttribute("open", "");
  await s
    .getByRole("button", { name: "合成画像を用意する", exact: true })
    .click();
  await p.locator(".p6-check input").check();
  await s.getByRole("group", { name: "画像の選択範囲" }).press("Enter");
  assert.equal(sent, 0);
  await s
    .getByRole("button", { name: "端末内で読み取る", exact: true })
    .click();
  await expect(s.locator(".quote-row").first()).toBeVisible({
    timeout: 125000,
  });
  for (const sel of await s.locator(".quote-row select").all())
    await sel.selectOption("me");
  await s
    .locator(".quote-row textarea")
    .first()
    .fill("確認して修正した合成発言");
  while ((await s.locator(".quote-row").count()) > 1)
    await s
      .locator(".quote-row")
      .last()
      .getByRole("button", { name: /削除/ })
      .click();
  await s.getByLabel("発言者・順番・重複・不明箇所を確認しました").check();
  await s
    .getByRole("button", { name: "確認した会話を下書きへ追加", exact: true })
    .click();
  await expect(p.locator("#trial-text")).toHaveValue(
    /保持する下書き[\s\S]*確認して修正した合成発言/,
  );
  assert.equal(sent, 0);
  assert.equal(await s.locator("canvas").count(), 0);
  results.realLocalOcr = true;
  results.correctedAppendPreservesDraft = true;
  results.noAutoSend = true;
  await s
    .getByRole("button", { name: "合成画像を用意する", exact: true })
    .click();
  await s
    .getByRole("button", { name: "画像・抽出結果を破棄する", exact: true })
    .click();
  assert.equal(await s.locator("canvas").count(), 0);
  await expect(p.locator("#trial-text")).toHaveValue(/保持する下書き/);
  results.discardPreservesDraft = true;
  await s.locator(":scope > summary").click();
  await s
    .getByRole("button", { name: "合成画像を用意する", exact: true })
    .click();
  await s
    .getByRole("button", { name: "端末内で読み取る", exact: true })
    .click();
  await s
    .getByRole("button", { name: "読み取りを中断する", exact: true })
    .click();
  await expect(s.locator("fieldset")).not.toHaveAttribute("disabled", "", {
    timeout: 125000,
  });
  await expect(p.locator("#trial-text")).toHaveValue(/保持する下書き/);
  results.cancelPreservesDraft = true;
  assert.equal(external, 0);
  await c.close();
} finally {
  await b.close();
}
await fs.writeFile(
  "/private/tmp/yorisoi-spacing-review/trial-ocr.json",
  JSON.stringify(results, null, 2),
);
console.log(results);
