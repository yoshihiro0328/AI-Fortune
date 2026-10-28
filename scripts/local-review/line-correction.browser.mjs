// Local synthetic fixtures produced by line-recognition.browser.mjs. No external images/data.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
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
    for (const route of [
      "/chat?topic=reply",
      "/consult?thread=sample-thread",
    ]) {
      const c = await b.newContext({ viewport: { width, height: 900 } });
      c.setDefaultTimeout(15000);
      let sent = 0,
        external = 0;
      await c.route("**/*", (r) => {
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
      await p.goto(base + route, { waitUntil: "networkidle", timeout: 60000 });
      const tag = route.startsWith("/chat") ? "chat" : "consult",
        s = p.locator("#screenshot-import"),
        input = p.locator(tag === "chat" ? "#trial-text" : "#chat-text");
      await input.fill("元の合成下書き");
      await s.locator(":scope > summary").click();
      const upload = async (names) => {
        await s
          .locator("input[type=file]")
          .setInputFiles(names.map((n) => out + "/" + n));
        await expect(s.locator(":scope > [role=status]")).toContainText(
          "画像を読み込みました",
        );
        await expect(s.locator("fieldset")).not.toHaveAttribute("disabled", "");
        await s
          .getByLabel(
            "LINEの1対1トークであることを確認しました（グループ・他アプリは対象外）",
          )
          .check();
      };
      const read = async (count) => {
        await s
          .getByRole("button", { name: "端末内で読み取る", exact: true })
          .click();
        await expect(s.locator("fieldset")).not.toHaveAttribute(
          "disabled",
          "",
          { timeout: 125000 },
        );
        await expect(s.locator(".message-bubble")).toHaveCount(count);
      };
      await upload([
        "synthetic-overlap-640-0.png",
        "synthetic-overlap-640-1.png",
      ]);
      await read(6);
      await expect(
        s.locator(".review-badge").filter({ hasText: "重複候補" }),
      ).toHaveCount(2);
      await s.locator(".message-bubble").nth(4).click();
      await s
        .getByRole("button", { name: "この発言を削除", exact: true })
        .click();
      await s.locator(".message-bubble").nth(4).click();
      await s
        .getByRole("button", { name: "この発言を削除", exact: true })
        .click();
      await expect(s.locator(".message-bubble")).toHaveCount(4);
      await s
        .getByRole("button", { name: "画像 2 を前へ", exact: true })
        .click();
      await expect(s.locator(".message-bubble")).toHaveCount(0);
      assert.equal(
        await s
          .locator(".screenshot-picture canvas")
          .first()
          .evaluate((c) => c.height),
        600,
      );
      await upload(["synthetic-quote-640-0.png"]);
      await read(4);
      await s.getByLabel("発言者・順番・重複・不明箇所を確認しました").check();
      await s
        .getByRole("button", {
          name: "確認した会話を下書きへ追加",
          exact: true,
        })
        .click();
      await expect(input).toHaveValue("元の合成下書き");
      await expect(s.locator(":scope > [role=status]")).toContainText(
        "発言者と本文を確認",
      );
      await s.locator(".message-bubble").nth(2).click();
      await s
        .getByLabel("本文", { exact: true })
        .fill("金曜日なら時間があるよ。");
      await s.locator(".message-editor summary").click();
      await s
        .getByLabel("引用された文（発言者は確定しません）", { exact: true })
        .fill("予定を確認してみるね。");
      await s
        .getByRole("button", {
          name: "引用と本文の区別を確認した",
          exact: true,
        })
        .click();
      await s
        .getByRole("button", { name: "編集を閉じる", exact: true })
        .click();
      await s.locator(".conversation-review").screenshot({
        path: `${out}/${tag}-${width}-quote.png`,
        timeout: 15000,
      });
      await s.getByLabel("発言者・順番・重複・不明箇所を確認しました").check();
      await s
        .getByRole("button", {
          name: "確認した会話を下書きへ追加",
          exact: true,
        })
        .click();
      await expect(input).toHaveValue(
        /元の合成下書き[\s\S]*引用・発言者未確定[\s\S]*新しく書かれた本文/,
      );
      const saved = await input.inputValue();
      await upload(["synthetic-group-640-0.png"]);
      await read(0);
      await expect(s.locator(":scope > [role=status]")).toContainText("複数人");
      await expect(input).toHaveValue(saved);
      await upload(["synthetic-repeat-640-0.png"]);
      await read(5);
      assert.equal(
        await s
          .locator(".restored-text")
          .filter({ hasText: /^ありがとう$/ })
          .count(),
        2,
      );
      await expect(
        s.locator(".review-badge").filter({ hasText: "重複候補" }),
      ).toHaveCount(0);
      const ed = s.locator(".screenshot-picture"),
        stage = ed.locator(".image-stage");
      await stage.focus();
      await stage.press("Space");
      await stage.press("ArrowRight");
      await stage.press("Shift+ArrowDown");
      await stage.press("Enter");
      await ed.getByRole("button", { name: "切り抜く", exact: true }).click();
      await expect(s.locator(".message-bubble")).toHaveCount(0);
      assert.ok(await ed.locator("canvas").evaluate((c) => c.width < 640));
      await ed
        .getByRole("button", { name: "編集をリセット", exact: true })
        .click();
      assert.equal(await ed.locator("canvas").evaluate((c) => c.width), 640);
      await expect(input).toHaveValue(saved);
      if (tag === "consult") {
        const picker = p.getByRole("button", {
          name: "相手・相談履歴を選ぶ",
          exact: true,
        });
        if (await picker.isVisible()) await picker.click();
        await p
          .locator(".subject-tab")
          .filter({ hasText: "サンプルBさん" })
          .click();
        await expect(input).toHaveValue("");
        await expect(p.locator("#screenshot-import canvas")).toHaveCount(0);
        if (await picker.isVisible()) await picker.click();
        await p
          .locator(".subject-tab")
          .filter({ hasText: "サンプルAさん" })
          .click();
        await expect(input).toHaveValue(saved);
        await expect(p.locator("#screenshot-import canvas")).toHaveCount(0);
      }
      assert.equal(sent, 0);
      assert.equal(external, 0);
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      results.push({
        route,
        width,
        overlap: true,
        imageOrder: true,
        quoteCorrection: true,
        unsupported: true,
        repeatPreserved: true,
        cropReset: true,
        subjectIsolation: tag === "consult",
        sent,
        external,
      });
      await c.close();
      console.log("correction verified", tag, width);
    }
  await fs.writeFile(
    out + "/correction-results.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await b.close();
}
