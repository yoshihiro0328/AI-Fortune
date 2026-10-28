import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318";
const h = await fetch(base + "/__review/health").then((r) => r.json());
assert.ok(h.synthetic && !h.external);
const b = await chromium.launch({ channel: "chrome", headless: true });
try {
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  let external = 0,
    failWorker = false;
  await c.route("**/*", (r) => {
    if (new URL(r.request().url()).origin !== base) {
      external++;
      return r.abort();
    }
    if (failWorker && r.request().url().endsWith("/ocr/worker.min.js"))
      return r.abort();
    return r.continue();
  });
  const p = await c.newPage();
  await p.goto(base + "/consult");
  await p.locator("#chat-text").fill("保持する下書き");
  await p.locator("#screenshot-import summary").click();
  const files = await p.evaluate(() =>
    [1, 2, 3].map((i) => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 300;
      const x = c.getContext("2d");
      x.fillStyle = "white";
      x.fillRect(0, 0, 640, 300);
      x.fillStyle = "black";
      x.font = "28px sans-serif";
      x.fillText(`画像${i}の発言`, 30, 70);
      x.fillText("予定を確認してみるね。", 30, 170);
      return c.toDataURL("image/png").split(",")[1];
    }),
  );
  await p.locator("input[type=file]").setInputFiles(
    files.map((v, i) => ({
      name: `synthetic-${i}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(v, "base64"),
    })),
  );
  await p.getByLabel("高さ（%）").first().fill("80");
  await p
    .getByRole("button", { name: "この範囲だけ切り抜く", exact: true })
    .first()
    .click();
  assert.equal(
    await p
      .locator("#screenshot-import canvas")
      .first()
      .evaluate((c) => c.height),
    240,
  );
  await p
    .getByRole("button", { name: "端末内で読み取る", exact: true })
    .click();
  await p.waitForFunction(
    () => !document.querySelector("#screenshot-import fieldset").disabled,
    null,
    { timeout: 125000 },
  );
  const rows = await p
    .locator(".quote-row textarea")
    .evaluateAll((es) => es.map((e) => e.value));
  assert.ok(rows.join("").indexOf("画像1") < rows.join("").indexOf("画像2"));
  assert.ok(rows.filter((x) => x.includes("予定を確認")).length === 3);
  assert.ok(
    (await p
      .getByText("同じ発言があります。重複か確認してください。")
      .count()) >= 3,
  );
  const first = rows[0],
    second = rows[1];
  await p.getByRole("button", { name: "発言2を上へ", exact: true }).click();
  assert.equal(await p.getByLabel("発言 1 の本文").inputValue(), second);
  assert.equal(await p.getByLabel("発言 2 の本文").inputValue(), first);
  // Finish state remains owned by this subject and is destroyed on a switch.
  const picker = p.getByRole("button", {
    name: "相手・相談履歴を選ぶ",
    exact: true,
  });
  if (await picker.isVisible()) await picker.click();
  await p.locator(".subject-tab").filter({ hasText: "サンプルBさん" }).click();
  await expect(p.locator("#chat-text")).toHaveValue("");
  assert.equal(await p.locator("#screenshot-import canvas").count(), 0);
  assert.equal(await p.locator(".quote-row").count(), 0);
  // A failed engine load cannot clear a draft or leave the UI disabled forever.
  await p.locator("#chat-text").fill("失敗しても残る文");
  await p.locator("#screenshot-import summary").click();
  await p
    .getByRole("button", { name: "合成画像を用意する", exact: true })
    .click();
  failWorker = true;
  await p
    .getByRole("button", { name: "端末内で読み取る", exact: true })
    .click();
  await expect(p.locator("#screenshot-import fieldset")).toBeEnabled({
    timeout: 125000,
  });
  await expect(p.locator("#screenshot-import > [role=status]")).toContainText(
    "読み取りを完了できませんでした",
  );
  assert.equal(await p.locator("#chat-text").inputValue(), "失敗しても残る文");
  assert.equal(external, 0);
  await fs.writeFile(
    "/private/tmp/yorisoi-ocr-review/flow.json",
    JSON.stringify({
      threeImages: true,
      order: true,
      duplicates: true,
      crop: true,
      mask: "separate real OCR test",
      manualReorder: true,
      subjectIsolation: true,
      failedEngineDraft: true,
      external,
    }),
  );
  console.log("OCR flow passed");
} finally {
  await b.close();
}
