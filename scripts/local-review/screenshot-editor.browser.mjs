// Synthetic images only. Network confined to the isolated local review server.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out =
    process.env.LOCAL_REVIEW_SCREENSHOTS ||
    "/private/tmp/yorisoi-screenshot-editor-review";
const h = await fetch(base + "/__review/health").then((r) => r.json());
assert.ok(h.ready && h.synthetic && !h.external);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [320, 390, 1280, 1440, 1920])
    for (const path of ["/chat?topic=reply", "/consult?thread=sample-thread"]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
      });
      ctx.setDefaultTimeout(15000);
      ctx.setDefaultNavigationTimeout(60000);
      let external = 0,
        sent = 0,
        fail = false;
      await ctx.route("**/*", (r) => {
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
      await ctx.request.post(base + "/__review/scenario", {
        maxRedirects: 0,
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=free",
      });
      const p = await ctx.newPage(),
        errors = [];
      p.on("pageerror", (e) => errors.push(e.name));
      await p.goto(base + path, { waitUntil: "networkidle" });
      const tag = path.startsWith("/chat") ? "chat" : "consult",
        input = p.locator(tag === "chat" ? "#trial-text" : "#chat-text");
      await input.fill("保持する合成の下書き");
      const purpose = p.locator(".purpose-picker select");
      await purpose.selectOption("review");
      const s = p.locator("#screenshot-import");
      await s.locator(":scope > summary").click();
      const check = async (stage) => {
        const over = await p.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert.ok(
          over.scroll <= over.width,
          `${tag}/${width}/${stage} ${JSON.stringify(over)}`,
        );
        const label = await p.locator(".purpose-picker").boundingBox();
        assert.ok(
          label.width > Math.min(180, width * 0.5),
          `purpose compressed ${label.width}`,
        );
        await expect(input).toHaveValue("保持する合成の下書き");
        await expect(purpose).toHaveValue("review");
      };
      const shot = async (name, locator) => {
        if ([390, 1440].includes(width)) {
          await locator.scrollIntoViewIfNeeded();
          const target =
            name === "expanded" ? p.locator(".purpose-picker") : locator;
          const position = await target.boundingBox();
          await p.evaluate((y) => scrollTo(0, scrollY + y - 100), position.y);
          await p.screenshot({ path: `${out}/${tag}-${width}-${name}.png` });
        }
      };
      await check("expanded");
      await shot("expanded", s);
      await s
        .getByRole("button", { name: "合成画像を用意する", exact: true })
        .click();
      const editor = s.locator(".screenshot-picture").first(),
        stage = editor.locator(".image-stage"),
        canvas = editor.locator("canvas");
      await check("image");
      await editor
        .getByRole("button", { name: "画像上で範囲を選ぶ", exact: true })
        .click();
      await stage.scrollIntoViewIfNeeded();
      let b = await stage.boundingBox();
      await p.mouse.move(b.x + 2, b.y + 2);
      await p.mouse.down();
      await p.mouse.move(b.x + b.width - 2, b.y + b.height * 0.15, {
        steps: 10,
      });
      await p.mouse.up();
      await expect(editor.locator(".image-selection")).toBeVisible();
      await check("selection");
      await shot("selection", stage);
      // Move, corner resize, and clamp by actual pointer, then restore a top mask by keyboard.
      const sel = editor.locator(".image-selection");
      let sb = await sel.boundingBox();
      await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await p.mouse.down();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height * 0.4, { steps: 5 });
      await p.mouse.up();
      const corner = sel.locator("[data-corner=se]");
      await corner.hover();
      await p.mouse.down();
      await p.mouse.move(b.x + b.width + 40, b.y + b.height + 30, { steps: 5 });
      await p.mouse.up();
      sb = await sel.boundingBox();
      assert.ok(
        sb.x >= b.x - 1 &&
          sb.x + sb.width <= b.x + b.width + 1 &&
          sb.y + sb.height <= b.y + b.height + 1,
      );
      await stage.press("Escape");
      await expect(sel).toHaveCount(0);
      await editor
        .getByRole("button", { name: "画像上で範囲を選ぶ", exact: true })
        .click();
      await stage.scrollIntoViewIfNeeded();
      b = await stage.boundingBox();
      await p.mouse.move(b.x + 1, b.y + 1);
      await p.mouse.down();
      await p.mouse.move(b.x + b.width - 1, b.y + b.height * 0.15, {
        steps: 6,
      });
      await p.mouse.up();
      await editor
        .getByRole("button", { name: "選択範囲を隠す", exact: true })
        .click();
      assert.deepEqual(
        await canvas.evaluate((c) =>
          Array.from(c.getContext("2d").getImageData(100, 60, 1, 1).data),
        ),
        [17, 17, 17, 255],
      );
      await editor
        .getByRole("button", { name: "ひとつ戻す", exact: true })
        .click();
      assert.notDeepEqual(
        await canvas.evaluate((c) =>
          Array.from(c.getContext("2d").getImageData(100, 60, 1, 1).data),
        ),
        [17, 17, 17, 255],
      );
      // Keyboard-only crop, undo/reset, and zoom retain the same source geometry.
      await stage.press("Space");
      await stage.press("ArrowRight");
      await stage.press("Shift+ArrowDown");
      await stage.press("Enter");
      await editor
        .getByRole("button", { name: "切り抜く", exact: true })
        .click();
      assert.ok(await canvas.evaluate((c) => c.width < 640 && c.height < 700));
      await editor
        .getByRole("button", { name: "編集をリセット", exact: true })
        .click();
      assert.equal(await canvas.evaluate((c) => c.width), 640);
      await editor.getByLabel("表示倍率").selectOption("2");
      await check("zoom");
      await editor.getByLabel("表示倍率").selectOption("1");
      // Multiple masks: hide the synthetic heading, and a second blank part at the bottom.
      await editor
        .getByRole("button", { name: "画像上で範囲を選ぶ", exact: true })
        .click();
      await stage.scrollIntoViewIfNeeded();
      b = await stage.boundingBox();
      await p.mouse.move(b.x + 1, b.y + 1);
      await p.mouse.down();
      await p.mouse.move(b.x + b.width - 1, b.y + b.height * 0.15, {
        steps: 6,
      });
      await p.mouse.up();
      await editor
        .getByRole("button", { name: "選択範囲を隠す", exact: true })
        .click();
      await stage.press("Space");
      await stage.press("Escape");
      await s
        .getByRole("button", { name: "端末内で読み取る", exact: true })
        .click();
      await expect(s.locator("fieldset")).toHaveAttribute("disabled", "");
      await check("busy");
      await expect(s.locator(".quote-row").first()).toBeVisible({
        timeout: 125000,
      });
      const text = await s
        .locator(".quote-row textarea")
        .evaluateAll((es) => es.map((e) => e.value).join("\n"));
      assert.ok(!text.includes("合成画像"), "masked heading cannot reach OCR");
      assert.ok(
        text.includes("予定") || text.includes("今週"),
        "actual local OCR read conversation",
      );
      await check("read");
      await s.locator(".quote-row select").first().selectOption("me");
      await s
        .locator(".quote-row textarea")
        .first()
        .fill("訂正した合成の発言。".repeat(40));
      await check("long correction");
      await s
        .locator(".quote-row")
        .first()
        .getByRole("button", { name: "読み取り元の画像と照合", exact: true })
        .click();
      await expect(s.locator(".source-comparison canvas")).toBeVisible();
      await shot("review", s.locator(".quote-row").first());
      // Editing after OCR invalidates every old row and confirm/append control.
      await editor
        .getByRole("button", { name: "ひとつ戻す", exact: true })
        .click();
      await expect(s.locator(".quote-row")).toHaveCount(0);
      await expect(
        s.getByRole("button", {
          name: "確認した会話を下書きへ追加",
          exact: true,
        }),
      ).toHaveCount(0);
      await s
        .getByRole("button", { name: "端末内で読み取る", exact: true })
        .click();
      await expect(s.locator(".quote-row").first()).toBeVisible({
        timeout: 125000,
      });
      while ((await s.locator(".quote-row").count()) > 1)
        await s
          .locator(".quote-row")
          .last()
          .getByRole("button", { name: /削除/ })
          .click();
      await s.locator(".quote-row select").first().selectOption("me");
      await s
        .locator(".quote-row textarea")
        .first()
        .fill("本人が訂正した合成の発言");
      await s.locator(".append-preview summary").click();
      await expect(s.locator(".append-preview pre")).toContainText(
        "本人が訂正した合成の発言",
      );
      await s.getByLabel("発言者・順番・重複・不明箇所を確認しました").check();
      await s
        .getByRole("button", {
          name: "確認した会話を下書きへ追加",
          exact: true,
        })
        .click();
      await expect(input).toHaveValue(
        /保持する合成の下書き[\s\S]*本人が訂正した合成の発言/,
      );
      assert.equal(sent, 0);
      await expect(s.locator("canvas")).toHaveCount(0);
      await input.fill("保持する合成の下書き");
      // Wide, tall, multiple images and 200% text, including deletion/order invalidation.
      const images = await p.evaluate(() =>
        [
          [300, 1800],
          [1800, 200],
          [640, 500],
        ].map(([w, h], i) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const x = c.getContext("2d");
          x.fillStyle = "white";
          x.fillRect(0, 0, w, h);
          x.fillStyle = "black";
          x.font = "12px sans-serif";
          x.fillText("合成の小さい文字 " + i, 10, 50);
          return c.toDataURL("image/png").split(",")[1];
        }),
      );
      await s.locator("input[type=file]").setInputFiles(
        images.map((data, i) => ({
          name: `synthetic-${i}.png`,
          mimeType: "image/png",
          buffer: Buffer.from(data, "base64"),
        })),
      );
      await expect(s.locator(".screenshot-picture")).toHaveCount(3);
      await check("multiple shapes");
      await s
        .getByRole("button", { name: "画像 3 を前へ", exact: true })
        .click();
      await s
        .getByRole("button", { name: "画像 2 を削除", exact: true })
        .click();
      await expect(s.locator(".screenshot-picture")).toHaveCount(2);
      await p.evaluate(() => {
        const els = [...document.querySelectorAll("main *")].map((e) => [
          e,
          getComputedStyle(e).fontSize,
        ]);
        for (const [e, size] of els)
          e.style.fontSize = parseFloat(size) * 2 + "px";
      });
      await check("text 200%");
      await s
        .getByRole("button", { name: "画像・抽出結果を破棄する", exact: true })
        .click();
      await expect(s).not.toHaveAttribute("open", "");
      await check("cancel");
      await s.locator(":scope > summary").click();
      await s
        .getByRole("button", { name: "合成画像を用意する", exact: true })
        .click();
      fail = true;
      await s
        .getByRole("button", { name: "端末内で読み取る", exact: true })
        .click();
      await expect(s.locator("fieldset")).not.toHaveAttribute("disabled", "", {
        timeout: 125000,
      });
      await expect(s.locator(":scope > [role=status]")).toContainText(
        "読み取りを完了できませんでした",
      );
      await check("failure");
      assert.equal(external, 0);
      assert.deepEqual(errors, []);
      results.push({
        path,
        width,
        stages:
          "expanded,selection,move,resize,mask,undo,crop,reset,zoom,actual OCR,edit invalidation,correction,append,multiple,tall,wide,200%,cancel,failure",
        sent,
        external,
        actualOcr: true,
      });
      await ctx.close();
      console.log("verified", tag, width);
    }
  await fs.writeFile(
    out + "/matrix.json",
    JSON.stringify(
      {
        results,
        physicalPhone: "not tested",
        touch: "separate emulated touch test",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
