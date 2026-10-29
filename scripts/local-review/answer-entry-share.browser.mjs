// Synthetic local browser regression. Real AI, billing, mail and outside origins are blocked.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318";
const out =
  process.env.LOCAL_REVIEW_SCREENSHOTS || "/private/tmp/yorisoi-three-ui";
const image = process.env.LOCAL_REVIEW_SYNTHETIC_IMAGE;
assert(image, "Provide a synthetic fixture image, never a real conversation");
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [320, 390, 844, 1440]) {
    const height = width === 844 ? 390 : 900;
    const context = await browser.newContext({
      viewport: { width, height },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    let hold = false,
      release,
      held = false,
      external = 0;
    const sent = [];
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== base) {
        external++;
        return route.abort();
      }
      if (
        /\/api\/consultations\/.+\/send$/.test(url.pathname) &&
        req.method() === "POST"
      ) {
        sent.push(req.postDataJSON());
        if (hold) {
          const response = await route.fetch();
          held = true;
          await new Promise((resolve) => {
            release = resolve;
          });
          hold = false;
          return route.fulfill({ response });
        }
      }
      return route.continue();
    });
    async function scenario(mode) {
      await context.request.post(base + "/__review/scenario", {
        headers: {
          origin: base,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: "mode=" + mode,
      });
    }
    const page = await context.newPage();
    await scenario("free");
    await page.goto(base + "/account", { waitUntil: "networkidle" });
    if (width < 1000) {
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      await page.locator('#site-menu-dialog a[href="/consult"]').click();
    } else await page.locator('.app-sidebar a[href="/consult"]').click();
    await expect(page.locator(".current-subject")).toHaveText(
      "相談相手を選んでください",
    );
    const write = page.getByRole("button", { name: "相談を書く", exact: true }),
      input = page.locator("#chat-text"),
      picker = page.locator("#subject-picker");
    await write.focus();
    await page.keyboard.press("Enter");
    await expect(picker.locator(".subject-tab").first()).toBeFocused();
    await expect(input).toBeDisabled();
    await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(0);
    await page.screenshot({ path: out + `/after-picker-${width}.png` });
    await page.keyboard.press("Enter");
    await expect(input).toBeEnabled();
    await expect(page.locator(".current-subject")).toContainText("サンプルA");
    await write.click();
    await expect(input).toBeFocused();
    await input.fill("Aだけの書きかけです。");
    const importer = page.locator("#screenshot-import");
    await importer.locator(".import-picker > summary").click();
    await importer.locator('input[type="file"]').setInputFiles(image);
    await expect(importer.locator(".import-count")).toContainText("会話4件", {
      timeout: 120000,
    });
    async function choose(name) {
      const toggle = page.locator(".mobile-subject-toggle");
      if (
        (await toggle.isVisible()) &&
        (await toggle.getAttribute("aria-expanded")) === "false"
      )
        await toggle.click();
      await picker.locator(".subject-tab").filter({ hasText: name }).click();
      await expect(page.locator(".current-subject")).toContainText(name);
      await expect(input).toBeEnabled();
    }
    await choose("サンプルB");
    await expect(input).toHaveValue("");
    await expect(page.locator(".import-count")).toHaveCount(0);
    await input.fill("Bだけの書きかけです。");
    await choose("サンプルA");
    await expect(input).toHaveValue("Aだけの書きかけです。");
    await expect(importer.locator(".import-count")).toContainText("会話4件");
    await input.fill("これは合成の長い相談です。\n".repeat(80));
    await page.getByRole("button", { name: "相談を送る", exact: true }).click();
    await expect(page.locator(".composer-feedback")).toContainText(
      "回答が届きました",
    );
    assert.equal((sent.at(-1).text.match(/返信ありがとう/g) || []).length, 1);
    const latest = page.getByRole("button", {
      name: "最近の回答を見る",
      exact: true,
    });
    await latest.focus();
    await page.keyboard.press("Enter");
    const answer = page.locator(".assistant-message").last();
    await expect(answer).toBeFocused();
    const answerVisible = () =>
      answer.evaluate((el) => {
        const history = el.closest(".chat-messages").getBoundingClientRect(),
          head = el
            .querySelector(".consult-answer-text")
            .getBoundingClientRect();
        return (
          head.top >= Math.max(history.top, 0) &&
          head.top + 20 < Math.min(history.bottom, innerHeight)
        );
      });
    await expect.poll(answerVisible).toBe(true);
    await page.screenshot({ path: out + `/after-answer-${width}.png` });
    // While awaiting another response, read older content: arrival must not steal page or history position.
    await input.fill("続きの合成相談です。");
    hold = true;
    await page.getByRole("button", { name: "相談を送る", exact: true }).click();
    await expect.poll(() => held).toBe(true);
    const history = page.locator(".chat-messages");
    await history.focus();
    await page.keyboard.press("Home");
    await expect.poll(() => history.evaluate((e) => e.scrollTop)).toBe(0);
    // Wait for the keyboard-initiated native scroll to settle before measuring arrival.
    await page.waitForTimeout(700);
    const reading = await page.evaluate(() => ({
      page: scrollY,
      inner: document.querySelector(".chat-messages").scrollTop,
      regionTop: document
        .querySelector(".chat-messages")
        .getBoundingClientRect().top,
      firstTop: document.querySelector(".chat-exchange").getBoundingClientRect()
        .top,
    }));
    release();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue("");
    const after = await page.evaluate(() => ({
      page: scrollY,
      inner: document.querySelector(".chat-messages").scrollTop,
      regionTop: document
        .querySelector(".chat-messages")
        .getBoundingClientRect().top,
      firstTop: document.querySelector(".chat-exchange").getBoundingClientRect()
        .top,
    }));
    // Native scroll anchoring may adjust page offset when the arrival notice grows above.
    // The content being read must remain at the same screen position.
    assert(
      Math.abs(reading.firstTop - after.firstTop) <= 2,
      JSON.stringify({ width, reading, after }),
    );
    assert(Math.abs(reading.inner - after.inner) <= 2);
    await latest.click();
    await expect(page.locator(".assistant-message").last()).toBeFocused();
    await expect.poll(answerVisible).toBe(true);
    // Zero subjects guides to adding a nickname without selecting anyone automatically.
    await scenario("empty");
    await page.goto(base + "/consult", { waitUntil: "networkidle" });
    await expect(page.locator(".current-subject")).toHaveText(
      "相談相手を追加してください",
    );
    await page.getByRole("button", { name: "相談を書く", exact: true }).click();
    await expect(page.locator("#nickname")).toBeFocused();
    await page.locator("#nickname").fill("合成の呼び名");
    await page.screenshot({ path: out + `/after-empty-${width}.png` });
    await page.goto(base + "/guides/slow-replies", {
      waitUntil: "networkidle",
    });
    const copy = page.locator(".share-tools button");
    await expect(copy).toHaveText("紹介文をコピー");
    await copy.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".share-tools [role=status]")).toContainText(
      "コピーしました",
    );
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied.includes("/diagnosis/partner-mind?source=share"));
    assert(!copied.includes("書きかけ"));
    await page.screenshot({ path: out + `/after-copy-${width}.png` });
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("Synthetic clipboard denial");
      };
    });
    await copy.click();
    await expect(page.locator(".share-tools [role=status]")).toContainText(
      "コピーできませんでした",
    );
    await page.screenshot({ path: out + `/copy-failure-${width}.png` });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    results.push({
      width,
      height,
      selectedGuidance: true,
      pickerKeyboard: true,
      zeroSubjects: true,
      draftAndMaterialSeparation: true,
      longInputAndOcr: true,
      answerStartVisible: true,
      readingPositionPreserved: true,
      copySuccess: true,
      copyFailure: true,
      external,
    });
    await context.close();
  }
  await fs.writeFile(out + "/after.json", JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
