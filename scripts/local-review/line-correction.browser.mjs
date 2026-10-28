// Correction/replacement/abort tests against local synthetic OCR fixtures only.
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
const b = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const width of [390, 1440])
    for (const tag of ["chat", "consult"]) {
      const c = await b.newContext({ viewport: { width, height: 900 } });
      c.setDefaultTimeout(15000);
      let sent = 0,
        external = 0,
        fail = false,
        delay = false;
      await c.route("**/*", async (r) => {
        const u = new URL(r.request().url());
        if (u.origin !== base) {
          external++;
          return r.abort();
        }
        if (
          r.request().method() === "POST" &&
          /api\/(trial|consultations)/.test(u.pathname)
        )
          sent++;
        if (u.pathname === "/ocr/worker.min.js") {
          if (fail) return r.abort();
          if (delay) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
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
      await p.goto(
        base +
          (tag === "chat"
            ? "/chat?topic=reply"
            : "/consult?thread=sample-thread"),
        { waitUntil: "networkidle", timeout: 60000 },
      );
      const s = p.locator("#screenshot-import"),
        input = p.locator(tag === "chat" ? "#trial-text" : "#chat-text");
      await input.fill("保持する元の相談文");
      const picker = async () => {
        if ((await s.locator(".import-picker").getAttribute("open")) === null)
          await s.locator(".import-picker>summary").click();
      };
      const read = async (names, count) => {
        await picker();
        await s
          .locator("input[type=file]")
          .setInputFiles(names.map((n) => out + "/" + n));
        await expect(s.locator(".import-count")).toContainText(
          `会話${count}件`,
          { timeout: 125000 },
        );
      };
      const editor = async () => {
        if (
          (await s.locator(".import-conversation").getAttribute("open")) ===
          null
        )
          await s.locator(".import-conversation>summary").click();
      };
      const cancel = async () => {
        await s
          .getByRole("button", { name: "取り込みを取り消す", exact: true })
          .click();
        await expect(input).toHaveValue("保持する元の相談文");
      };
      const check = async () =>
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      // Recognized metadata is visible, editable, and independent from dates inside body.
      await read(["synthetic-background-640-0.png"], 4);
      await editor();
      await s.locator(".message-bubble").first().click();
      await expect(s.getByLabel("日付（読めた範囲だけ・空欄可）")).toHaveValue(
        "10月28日",
      );
      await expect(s.getByLabel("時刻（空欄可）", { exact: true })).toHaveValue(
        "19:35",
      );
      await s.getByLabel("本文", { exact: true }).fill("訂正を保持する");
      await s
        .getByRole("button", { name: "編集を閉じる", exact: true })
        .click();
      // Pixel edit invalidates source association, but does not delete corrections.
      await s.locator(".import-image-editor>summary").click();
      const ed = s.locator(".screenshot-picture"),
        stage = ed.locator(".image-stage");
      await ed
        .getByRole("button", { name: "画像上で範囲を選ぶ", exact: true })
        .click();
      await stage.scrollIntoViewIfNeeded();
      const box = await stage.boundingBox();
      await p.mouse.move(box.x + 2, box.y + 2);
      await p.mouse.down();
      await p.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.08, {
        steps: 8,
      });
      await p.mouse.up();
      await ed
        .getByRole("button", { name: "選択範囲を隠す", exact: true })
        .click();
      await expect(s.locator(".restored-text").first()).toHaveText(
        "訂正を保持する",
      );
      await expect(
        s.getByRole("button", {
          name: "画像の変更を取り消し、以前の会話を保持",
          exact: true,
        }),
      ).toBeVisible();
      await s
        .getByRole("button", { name: "編集した画像を再読み取り", exact: true })
        .click();
      await expect(
        s.getByRole("button", { name: "新しい結果に置き換える", exact: true }),
      ).toBeVisible({ timeout: 125000 });
      await expect(
        s.locator(".import-conversation .restored-text").first(),
      ).toHaveText("訂正を保持する");
      await s
        .getByRole("button", {
          name: "画像の変更を取り消し、以前の会話を保持",
          exact: true,
        })
        .click();
      await expect(s.locator(".import-thumbnails")).toHaveCount(0);
      await expect(s.locator(".restored-text").first()).toHaveText(
        "訂正を保持する",
      );
      // Failed reread also preserves corrections. Then replacement is an explicit action.
      fail = true;
      await picker();
      await s
        .locator("input[type=file]")
        .setInputFiles(out + "/synthetic-light-640-0.png");
      await expect(s.locator(":scope>[role=status]")).toContainText(
        "読み取りを完了できません",
        { timeout: 125000 },
      );
      fail = false;
      await expect(s.locator(".restored-text").first()).toHaveText(
        "訂正を保持する",
      );
      await picker();
      await s
        .locator("input[type=file]")
        .setInputFiles(out + "/synthetic-light-640-0.png");
      await expect(
        s.getByRole("button", { name: "新しい結果に置き換える", exact: true }),
      ).toBeVisible({ timeout: 125000 });
      await s
        .getByRole("button", { name: "新しい結果に置き換える", exact: true })
        .click();
      await expect(s.locator(".restored-text").first()).not.toHaveText(
        "訂正を保持する",
      );
      await cancel();
      // Two images, exact overlap candidates retained until a decision.
      await read(
        ["synthetic-overlap-640-0.png", "synthetic-overlap-640-1.png"],
        6,
      );
      await editor();
      await expect(
        s.locator(".review-badge").filter({ hasText: "重複候補" }),
      ).toHaveCount(2);
      for (const [i, decision] of [
        [4, "重複候補を残す"],
        [5, "重複候補を除外"],
      ]) {
        await s.locator(".message-bubble").nth(i).click();
        await s.getByRole("button", { name: decision, exact: true }).click();
        await s
          .getByRole("button", { name: "編集を閉じる", exact: true })
          .click();
      }
      await expect(s.locator(".import-count")).toContainText("送信対象5件");
      await check();
      await s.screenshot({ path: `${out}/${tag}-${width}-duplicates.png` });
      await cancel();
      // Geometric quote signal is separate from ordinary word 返信.
      await read(["synthetic-quote-640-0.png"], 4);
      await editor();
      await expect(s.locator(".import-errors")).toContainText("発言3：引用");
      await s.locator(".message-bubble").nth(2).click();
      await s
        .getByRole("button", {
          name: "不明部分を明示したまま使う",
          exact: true,
        })
        .click();
      await expect(s.locator(".import-errors")).toHaveCount(0);
      await cancel();
      await read(["synthetic-cropped-640-0.png"], 4);
      await editor();
      assert.ok(
        (await s.locator(".message-bubble strong").allTextContents()).includes(
          "発言者：要確認",
        ),
      );
      await cancel();
      // Cancellation of an in-flight worker must not mutate a subsequent import.
      delay = true;
      await picker();
      await s
        .locator("input[type=file]")
        .setInputFiles(out + "/synthetic-light-640-0.png");
      await s
        .getByRole("button", { name: "読み取りを中断する", exact: true })
        .click();
      await expect(s.locator(":scope>[role=status]")).toContainText(
        "読み取りを完了できません",
        { timeout: 125000 },
      );
      delay = false;
      await expect(input).toHaveValue("保持する元の相談文");
      await read(["synthetic-body-date-only-640-0.png"], 4);
      await editor();
      await expect(s.locator(".message-time")).toHaveCount(0);
      await expect(s.locator(".restored-text").first()).toContainText(
        "10月28日",
      );
      await cancel();
      await picker();
      await s
        .locator("input[type=file]")
        .setInputFiles(out + "/synthetic-group-640-0.png");
      await expect(s.locator(":scope>[role=status]")).toContainText(
        "LINEの1対1",
        { timeout: 125000 },
      );
      await expect(s.locator(".import-count")).toHaveCount(0);
      assert.equal(sent, 0);
      assert.equal(external, 0);
      await check();
      results.push({
        tag,
        width,
        recognizedMetadata: true,
        correctionsRetained: true,
        maskReread: true,
        explicitReplacement: true,
        failedReread: true,
        duplicatesChoice: true,
        quoteUnknown: true,
        unknownSpeaker: true,
        cancel: true,
        bodyDateNotMetadata: true,
        unsupported: true,
        sent,
        external,
      });
      await fs.writeFile(
        out + "/correction-results.json",
        JSON.stringify(
          { results, realImages: "not tested", physicalPhone: "not tested" },
          null,
          2,
        ),
      );
      console.log(tag, width, "corrections passed");
      await c.close();
    }
} finally {
  await b.close();
}
