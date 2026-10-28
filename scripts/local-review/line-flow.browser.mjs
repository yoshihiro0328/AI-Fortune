// Synthetic, local-only end-to-end LINE restoration and correction. No AI calls.
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
await fs.mkdir(out, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const width of process.env.REVIEW_WIDTHS?.split(",").map(Number) ?? [
    320, 390, 1280, 1440, 1920,
  ])
    for (const route of [
      "/chat?topic=reply",
      "/consult?thread=sample-thread",
    ]) {
      const c = await b.newContext({ viewport: { width, height: 900 } });
      c.setDefaultTimeout(15000);
      c.setDefaultNavigationTimeout(60000);
      let sent = 0,
        external = 0,
        fail = false;
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
        if (fail && u.pathname === "/ocr/worker.min.js") return r.abort();
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
      const p = await c.newPage(),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.name));
      await p.goto(base + route, { waitUntil: "networkidle" });
      const tag = route.startsWith("/chat") ? "chat" : "consult",
        input = p.locator(tag === "chat" ? "#trial-text" : "#chat-text"),
        s = p.locator("#screenshot-import"),
        purpose = p.locator(".purpose-picker select");
      await input.fill("保持する合成の下書き");
      await purpose.selectOption("review");
      await s.locator(":scope > summary").click();
      const check = async (stage) => {
        console.log(tag, width, stage);
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${tag}/${width}/${stage} overflow`,
        );
        await expect(purpose).toHaveValue("review");
        const r = await p.locator(".purpose-picker").boundingBox();
        assert.ok(r.width > Math.min(180, width * 0.5));
      };
      const shot = async (name, locator) => {
        if ([390, 1440].includes(width)) {
          await locator.scrollIntoViewIfNeeded();
          await locator.screenshot({
            timeout: 15000,
            path: `${out}/${tag}-${width}-${name}.png`,
          });
        }
      };
      await check("expanded");
      await s
        .getByRole("button", { name: "合成画像を用意する", exact: true })
        .click();
      const editor = s.locator(".screenshot-picture").first(),
        stage = editor.locator(".image-stage");
      await shot("expanded", editor);
      await editor
        .getByRole("button", { name: "画像上で範囲を選ぶ", exact: true })
        .click();
      await stage.scrollIntoViewIfNeeded();
      let box = await stage.boundingBox();
      await p.mouse.move(box.x + 2, box.y + 2);
      await p.mouse.down();
      await p.mouse.move(box.x + box.width - 2, box.y + box.height * 0.095, {
        steps: 8,
      });
      await p.mouse.up();
      await expect(editor.locator(".image-selection")).toBeVisible();
      await shot("selection", editor);
      await editor
        .getByRole("button", { name: "選択範囲を隠す", exact: true })
        .click();
      await s
        .getByRole("button", { name: "端末内で読み取る", exact: true })
        .click();
      await expect(s.locator(".message-bubble")).toHaveCount(4, {
        timeout: 125000,
      });
      await check("read");
      const labels = await s
        .locator(".message-bubble > strong")
        .allTextContents();
      assert.deepEqual(labels, ["相手", "自分", "自分", "相手"]);
      assert.ok(
        !(await s.locator(".restored-text").allTextContents())
          .join("")
          .includes("架空"),
      );
      await shot("review", s.locator(".conversation-review"));
      await s.locator(".message-bubble").first().scrollIntoViewIfNeeded();
      const wheelBox = await s.locator(".message-bubble").first().boundingBox(),
        yBefore = await p.evaluate(() => scrollY);
      await p.mouse.move(
        wheelBox.x + wheelBox.width / 2,
        wheelBox.y + wheelBox.height / 2,
      );
      await p.mouse.wheel(0, 250);
      await p.waitForTimeout(200);
      assert.ok(
        (await p.evaluate(() => scrollY)) > yBefore,
        "conversation does not trap page scroll",
      );

      // Keyboard opens only the selected bubble; correction, split/merge, ordering and swap.
      const first = s.locator(".message-bubble").first();
      await first.focus();
      await first.press("Enter");
      await expect(s.locator(".message-editor")).toHaveCount(1);
      await check("editor");
      await s
        .getByLabel("本文", { exact: true })
        .fill("訂正した文。後半の文。");
      await s.locator(".message-editor summary").click();
      await s.getByLabel("この文字列の直前で分割").fill("後半");
      await s.getByRole("button", { name: "ここで分割", exact: true }).click();
      await expect(s.locator(".message-bubble")).toHaveCount(5);
      await s
        .getByRole("button", { name: "次の同じ発言者と結合", exact: true })
        .click();
      await expect(s.locator(".message-bubble")).toHaveCount(4);
      await s.getByRole("button", { name: "下へ", exact: true }).click();
      await s.getByRole("button", { name: "上へ", exact: true }).click();
      await s
        .getByRole("button", { name: "編集を閉じる", exact: true })
        .click();
      await expect(first).toBeFocused();
      await s
        .getByRole("button", {
          name: "自分と相手をまとめて入れ替える",
          exact: true,
        })
        .click();
      assert.deepEqual(
        await s.locator(".message-bubble > strong").allTextContents(),
        ["自分", "相手", "相手", "自分"],
      );
      await s
        .getByRole("button", {
          name: "自分と相手をまとめて入れ替える",
          exact: true,
        })
        .click();
      if (width < 900) {
        await s
          .getByRole("button", { name: "画像を見る", exact: true })
          .click();
        await expect(s.locator(".review-source")).toBeVisible();
        await expect(s.locator(".review-messages")).toBeHidden();
        await s
          .getByRole("button", { name: "会話を見る", exact: true })
          .click();
      }
      // Editing pixels after OCR invalidates corrected text and confirmation.
      await editor
        .getByRole("button", { name: "ひとつ戻す", exact: true })
        .click();
      await expect(s.locator(".message-bubble")).toHaveCount(0);
      await expect(input).toHaveValue("保持する合成の下書き");
      await s
        .getByRole("button", { name: "端末内で読み取る", exact: true })
        .click();
      await expect(s.locator(".message-bubble")).toHaveCount(4, {
        timeout: 125000,
      });
      await s.getByLabel("発言者・順番・重複・不明箇所を確認しました").check();
      const add = s.getByRole("button", {
        name: "確認した会話を下書きへ追加",
        exact: true,
      });
      await add.evaluate((el) => {
        el.click();
        el.click();
      });
      await expect(input).toHaveValue(/保持する合成の下書き[\s\S]*今週/);
      assert.equal(
        (await input.inputValue()).split("本人が確認した画像内").length - 1,
        1,
      );
      assert.equal(sent, 0);
      await expect(s.locator("canvas")).toHaveCount(0);
      // 200% text in expanded editor and recovered conversation, including long body.
      await s
        .getByRole("button", { name: "合成画像を用意する", exact: true })
        .click();
      await s
        .getByRole("button", { name: "端末内で読み取る", exact: true })
        .click();
      await expect(s.locator(".message-bubble")).toHaveCount(4, {
        timeout: 125000,
      });
      await s.locator(".message-bubble").first().click();
      await s
        .getByLabel("本文", { exact: true })
        .fill("訂正した長い合成文。".repeat(50));
      await p.evaluate(() => {
        const entries = [...document.querySelectorAll("main *")].map((e) => [
          e,
          getComputedStyle(e).fontSize,
        ]);
        for (const [e, size] of entries)
          e.style.fontSize = parseFloat(size) * 2 + "px";
      });
      await check("200% text");
      await s
        .getByRole("button", { name: "画像・抽出結果を破棄する", exact: true })
        .click();
      await expect(s).not.toHaveAttribute("open", "");
      await expect(s.locator("canvas")).toHaveCount(0);
      const saved = await input.inputValue();
      await s.locator(":scope > summary").click();
      await s
        .getByRole("button", { name: "合成画像を用意する", exact: true })
        .click();
      fail = true;
      await s
        .getByRole("button", { name: "端末内で読み取る", exact: true })
        .click();
      await expect(s.locator(":scope > [role=status]")).toContainText(
        "読み取りを完了できませんでした",
        { timeout: 125000 },
      );
      await expect(input).toHaveValue(saved);
      await check("failure");
      assert.equal(external, 0);
      assert.deepEqual(errors, []);
      results.push({
        route,
        width,
        actualOCR: true,
        mouse: true,
        keyboard: true,
        text200: true,
        external,
        sent,
      });
      await c.close();
      console.log("verified", tag, width);
      await fs.writeFile(
        out + "/flow-results.json",
        JSON.stringify({ results, physicalPhone: "not tested" }, null, 2),
      );
    }
} finally {
  await b.close();
}
