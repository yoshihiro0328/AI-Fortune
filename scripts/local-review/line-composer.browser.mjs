// Isolated UI regression: synthetic pixels, local OCR, local fixture send only.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out =
    process.env.LOCAL_REVIEW_SCREENSHOTS ||
    "/private/tmp/yorisoi-line-composer";
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const width of process.env.REVIEW_WIDTHS?.split(",").map(Number) ?? [
    320, 390, 1280, 1440, 1920,
  ])
    for (const tag of ["chat", "consult"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
      });
      context.setDefaultTimeout(15000);
      context.setDefaultNavigationTimeout(60000);
      let external = 0,
        failSend = true,
        blockOcr = false;
      const sends = [],
        errors = [];
      await context.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url());
        if (u.origin !== base) {
          external++;
          return route.abort();
        }
        if (blockOcr && u.pathname === "/ocr/worker.min.js")
          return route.abort();
        if (
          req.method() === "POST" &&
          (/\/send$/.test(u.pathname) || u.pathname === "/api/trial/turns")
        ) {
          sends.push(req.postDataJSON());
          if (failSend)
            return route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "合成の通信失敗。下書きは保持。" }),
            });
        }
        return route.continue();
      });
      await context.request.post(base + "/__review/scenario", {
        maxRedirects: 0,
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=free",
      });
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.name));
      await p.goto(
        base +
          (tag === "chat"
            ? "/chat?topic=reply"
            : "/consult?thread=sample-thread"),
        { waitUntil: "networkidle" },
      );
      const s = p.locator("#screenshot-import"),
        input = p.locator(tag === "chat" ? "#trial-text" : "#chat-text"),
        button = p.getByRole("button", {
          name: tag === "chat" ? "登録なしで試す" : "相談を送る",
          exact: true,
        });
      await input.fill("保持する合成の相談文");
      await s.locator(".import-picker > summary").click();
      await s
        .locator("input[type=file]")
        .setInputFiles(out + "/synthetic-reply-date-640-0.png");
      await expect(s.locator(".import-count")).toContainText("会話4件", {
        timeout: 125000,
      });
      await expect(s.locator(".import-conversation")).not.toHaveAttribute(
        "open",
        "",
      );
      await expect(s.locator(".review-source")).toBeHidden();
      assert.equal(sends.length, 0);
      await expect(input).toHaveValue("保持する合成の相談文");
      const check = async (stage) => {
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${tag} ${width} ${stage}: overflow`,
        );
        assert.ok(
          (await p.locator(".purpose-picker").boundingBox()).width >
            Math.min(180, width * 0.5),
        );
      };
      const shot = async (stage) => {
        if ([390, 1440].includes(width)) {
          await s.scrollIntoViewIfNeeded();
          await s.screenshot({ path: `${out}/${tag}-${width}-${stage}.png` });
        }
      };
      await check("compact");
      await shot("compact");
      await s.locator(".import-conversation > summary").press("Enter");
      await expect(s.locator(".message-bubble")).toHaveCount(4);
      assert.deepEqual(
        await s.locator(".message-bubble strong").allTextContents(),
        ["相手", "自分", "自分", "相手"],
      );
      assert.ok(!(await s.innerText()).includes("引用と本文が混ざって"));
      await s.locator(".message-bubble").first().press("Enter");
      await s.getByLabel("本文", { exact: true }).fill("返信ありがとう");
      await s.getByLabel("日付（読めた範囲だけ・空欄可）").fill("10月28日");
      await s.getByLabel("時刻（空欄可）", { exact: true }).fill("19:35");
      await s
        .getByRole("button", { name: "訂正した内容を確認した", exact: true })
        .click();
      await check("editing");
      await shot("editing");
      // Explicit unknown-speaker path is usable without inventing identity.
      await s.getByLabel("発言者", { exact: true }).selectOption("unknown");
      await expect(s.locator(".import-errors")).toContainText("発言1：発言者");
      await expect(button).toBeDisabled();
      await s
        .getByRole("button", {
          name: "不明部分を明示したまま使う",
          exact: true,
        })
        .click();
      await expect(s.locator(".import-errors")).toHaveCount(0);
      await s.getByLabel("発言者", { exact: true }).selectOption("other");
      await s
        .getByRole("button", { name: "訂正した内容を確認した", exact: true })
        .click();
      // Oversize material is preserved; selecting fewer messages solves the limit.
      await s
        .getByLabel("本文", { exact: true })
        .fill("長い合成文".repeat(190));
      await input.fill("元の本文".repeat(tag === "chat" ? 140 : 790));
      await expect(button).toBeDisabled();
      await expect(
        p.getByText(/上限超過：送る発言を減らしてください/),
      ).toBeVisible();
      await s.getByLabel("発言1を送る", { exact: false }).uncheck();
      await input.fill("保持する合成の相談文");
      await s.getByLabel("本文", { exact: true }).fill("返信ありがとう");
      await s.getByLabel("発言1を送る", { exact: false }).check();
      await s
        .getByRole("button", { name: "編集を閉じる", exact: true })
        .click();
      await expect(s.locator(".message-bubble").first()).toBeFocused();
      // Source on demand, wheel must reach page rather than trapping it.
      await s.getByRole("button", { name: "画像を見る", exact: true }).click();
      await expect(s.locator(".review-source")).toBeVisible();
      await s.getByRole("button", { name: "会話を見る", exact: true }).click();
      await s.locator(".message-bubble").first().scrollIntoViewIfNeeded();
      const box = await s.locator(".message-bubble").first().boundingBox(),
        before = await p.evaluate(() => scrollY);
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.wheel(0, 250);
      await p.waitForTimeout(200);
      assert.ok((await p.evaluate(() => scrollY)) > before);
      await p.addStyleTag({ content: "html {font-size:200% !important}" });
      await check("200-percent");
      await p
        .locator("style")
        .last()
        .evaluate((e) => e.remove());
      if (tag === "consult") {
        const subject = async (letter) => {
          const toggle = p.getByRole("button", {
            name: "相手・相談履歴を選ぶ",
            exact: true,
          });
          if (await toggle.isVisible()) await toggle.click();
          await p
            .locator(".subject-tab")
            .filter({ hasText: "サンプル" + letter + "さん" })
            .click();
          await expect(input).toBeEnabled();
        };
        await subject("B");
        await expect(input).toHaveValue("");
        await expect(s.locator(".import-count")).toHaveCount(0);
        await input.fill("Bの下書き");
        await subject("A");
        await expect(input).toHaveValue("保持する合成の相談文");
        await expect(s.locator(".import-count")).toContainText("会話4件");
      }
      if (tag === "chat") await p.locator(".p6-check input").first().check();
      await expect(button).toBeEnabled();
      await button.dblclick();
      await expect(p.locator("p[role=alert]")).toContainText("合成の通信失敗");
      assert.equal(sends.length, 1);
      await expect(input).toHaveValue("保持する合成の相談文");
      await expect(s.locator(".import-count")).toContainText("会話4件");
      failSend = false;
      await p
        .getByRole("button", {
          name: tag === "chat" ? "登録なしで試す" : "同じ内容を再送する",
          exact: true,
        })
        .click();
      await expect.poll(() => sends.length).toBe(2);
      assert.equal(sends[0].requestId, sends[1].requestId);
      assert.equal(sends[0].text, sends[1].text);
      assert.equal(
        (sends[1].text.match(/画像から取り込んだ会話/g) || []).length,
        1,
      );
      assert.ok(
        sends[1].text.includes(
          "[日付：10月28日・時刻：19:35] 相手：返信ありがとう",
        ),
      );
      await expect(s.locator(".import-count")).toHaveCount(0);
      assert.equal(external, 0);
      assert.deepEqual(errors, []);
      results.push({
        tag,
        width,
        autoOCR: true,
        normalReplyNotQuoted: true,
        dateForwarded: true,
        compact: true,
        characterLimit: true,
        unknownExplicit: true,
        scroll: true,
        keyboard: true,
        zoom200: true,
        scopeIsolation: tag === "consult",
        failureRetention: true,
        retrySamePayload: true,
        external,
        errors,
      });
      await fs.writeFile(
        out + "/composer-results.json",
        JSON.stringify(
          {
            results,
            physicalPhone: "not tested",
            realLineImages: "not tested",
          },
          null,
          2,
        ),
      );
      console.log(tag, width, "passed");
      await context.close();
    }
} finally {
  await browser.close();
}
