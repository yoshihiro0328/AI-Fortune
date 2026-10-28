// All input is synthetic, provider routes are local fixtures, all external requests blocked.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:5318",
  out =
    process.env.LOCAL_REVIEW_SCREENSHOTS ||
    "/private/tmp/yorisoi-ui-regression",
  image = process.env.LOCAL_REVIEW_SYNTHETIC_IMAGE;
assert(image, "Pass a synthetic fixture image");
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
await fs.mkdir(out, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [320, 390, 430, 768, 999, 1000, 1280, 1440, 1920]) {
    const c = await b.newContext({
      viewport: { width, height: width < 500 ? 740 : 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    c.setDefaultTimeout(15000);
    c.setDefaultNavigationTimeout(60000);
    let fault = "",
      postCount = 0,
      external = 0;
    const payloads = [];
    await c.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      if (u.origin !== base) {
        external++;
        return route.abort();
      }
      if (
        /\/api\/consultations\/.+\/send$/.test(u.pathname) &&
        req.method() === "POST"
      ) {
        postCount++;
        payloads.push({ url: u.pathname, ...req.postDataJSON() });
        if (fault === "reject") {
          fault = "";
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error:
                "合成の入力拒否です。短く訂正してください。処理は開始していません。",
              code: "INPUT_REJECTED",
            }),
          });
        }
        if (fault === "lost") {
          fault = "";
          await route.fetch();
          return route.abort();
        }
        if (fault === "offline") {
          fault = "";
          return route.abort();
        }
      }
      return route.continue();
    });
    await c.request.post(base + "/__review/scenario", {
      headers: {
        origin: base,
        "content-type": "application/x-www-form-urlencoded",
      },
      data: "mode=free",
    });
    const p = await c.newPage();
    await p.goto(base + "/account", { waitUntil: "networkidle" });
    await p
      .getByRole("link", { name: "サンプルCさん（会話なし）", exact: true })
      .click();
    await expect(p.locator(".current-subject")).toContainText("サンプルCさん");
    await expect(p.locator(".chat-exchange")).toHaveCount(0);
    const input = p.locator("#chat-text"),
      send = p.getByRole("button", { name: "相談を送る", exact: true }),
      s = p.locator("#screenshot-import");
    await input.fill("Cの合成相談です。返信を考えたいです。");
    await s.locator(".import-picker > summary").click();
    await s.locator("input[type=file]").setInputFiles(image);
    await expect(s.locator(".import-count")).toContainText("会話4件", {
      timeout: 125000,
    });
    await s.locator(".import-conversation > summary").click();
    await s.getByRole("button", { name: "編集を閉じて相談入力へ戻る" }).click();
    await expect(input).toHaveValue("Cの合成相談です。返信を考えたいです。");
    await send.click();
    await expect(p.locator(".composer-feedback")).toContainText(
      "回答が届きました",
    );
    assert.equal(
      payloads.at(-1).url,
      "/api/consultations/sample-thread-3/send",
    );
    assert.equal(
      (payloads.at(-1).text.match(/返信ありがとう/g) || []).length,
      1,
    );
    await p
      .locator(".composer-feedback")
      .getByRole("button", { name: "最近の回答を見る" })
      .click();
    await expect(p.locator(".chat-exchange").last()).toBeFocused();
    await p
      .getByRole("button", { name: "文面だけをコピー", exact: true })
      .last()
      .click();
    await p.screenshot({ path: `${out}/reply-${width}.png` });
    // Confirmed rejection can be corrected, unknown result cannot create a new execution.
    await input.fill("長".repeat(2300));
    fault = "reject";
    await send.click();
    await expect(p.locator(".composer-feedback [role=alert]")).toContainText(
      "入力拒否",
    );
    await input.fill("短く訂正した合成相談");
    await expect(send).toBeEnabled();
    await p.screenshot({ path: `${out}/corrected-${width}.png` });
    await send.click();
    await expect(input).toHaveValue("");
    await input.fill("結果不明の合成相談");
    fault = "lost";
    await send.click();
    await expect(p.locator(".composer-feedback")).toContainText("未確認");
    await expect(send).toBeDisabled();
    const before = postCount;
    await p
      .getByRole("button", { name: "同じ内容を再送する", exact: true })
      .click();
    await expect(input).toHaveValue("");
    assert.equal(postCount, before, "resolved reply must not post again");
    await input.fill("通信前に失敗した相談");
    fault = "offline";
    await send.click();
    await expect(p.locator(".composer-feedback")).toContainText("未確認");
    const previous = payloads.at(-1);
    await p
      .getByRole("button", { name: "同じ内容を再送する", exact: true })
      .click();
    await expect(input).toHaveValue("");
    assert.deepEqual(payloads.at(-1), previous);
    // Restore OCR material without source, inspect spacing and absent source controls.
    await input.fill("Cの未送信下書き");
    await s.locator(".import-picker > summary").click();
    await s.locator("input[type=file]").setInputFiles(image);
    await expect(s.locator(".import-count")).toContainText("会話4件", {
      timeout: 125000,
    });
    async function choose(name) {
      const toggle = p.locator(".mobile-subject-toggle");
      if (
        (await toggle.isVisible()) &&
        (await toggle.getAttribute("aria-expanded")) === "false"
      )
        await toggle.click();
      await p
        .getByRole("button", { name: new RegExp(name) })
        .filter({ has: p.locator(".subject-name") })
        .click();
    }
    await choose("サンプルB");
    await expect(input).toHaveValue("");
    await expect(p.locator(".import-count")).toHaveCount(0);
    await input.fill("Bだけの下書き");
    await choose("サンプルC");
    await expect(input).toHaveValue("Cの未送信下書き");
    await expect(s.locator(".import-count")).toContainText("会話4件");
    await s.locator(".import-conversation > summary").click();
    await expect(
      s.getByRole("button", { name: "画像を見る", exact: true }),
    ).toHaveCount(0);
    await expect(
      s.getByRole("button", { name: "選んだ部分を拡大" }),
    ).toHaveCount(0);
    const gap = await s.evaluate(
      (e) =>
        e.querySelector(".import-dismiss-actions").getBoundingClientRect().top -
        e.querySelector(".conversation-review").getBoundingClientRect().bottom,
    );
    assert(gap >= 16, "restored cancel spacing");
    await p.screenshot({ path: `${out}/restored-${width}.png` });
    await s
      .getByRole("button", { name: "取り込みを取り消す", exact: true })
      .click();
    await expect(input).toHaveValue("Cの未送信下書き");
    await expect(s.locator(".import-count")).toHaveCount(0);
    await p.goto(base + "/consult?subject=unowned", {
      waitUntil: "networkidle",
    });
    await expect(p.locator(".chat-exchange")).toHaveCount(0);
    await expect(input).toBeDisabled();
    await expect(p.locator(".current-subject")).not.toContainText("サンプルA");
    // Diagnosis local error and consent before trial action.
    await p.goto(base + "/diagnosis/partner-mind?resume=sample-draft", {
      waitUntil: "networkidle",
    });
    await p.getByRole("button", { name: "保存して次へ", exact: true }).click();
    await expect(p.locator("#question-error")).toBeVisible();
    await p.screenshot({ path: `${out}/diagnosis-error-${width}.png` });
    await p.goto(base + "/chat", { waitUntil: "networkidle" });
    await p.locator("#trial-text").fill("合成の相談文");
    const consent = p.locator(".p6-check");
    const trialSend = p.getByRole("button", {
      name: "登録なしで試す",
      exact: true,
    });
    await expect(trialSend).toBeDisabled();
    assert((await consent.boundingBox()).y < (await trialSend.boundingBox()).y);
    await expect(p.locator(".composer-feedback")).toContainText("同意欄");
    await p.screenshot({ path: `${out}/consent-${width}.png` });
    await p.addStyleTag({ content: "html{font-size:200%}" });
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    results.push({
      width,
      selectedEmptySubject: true,
      rejectionCorrected: true,
      unknownReconciledWithoutResend: true,
      offlineSameId: true,
      replyFocus: true,
      copy: true,
      draftSeparation: true,
      sourceControlsAbsent: true,
      restoredSpacing: gap,
      diagnosisError: true,
      consentBeforeSend: true,
      zoom200: true,
      external,
    });
    await c.close();
    console.log("Flow passed", width);
  }
  await fs.writeFile(
    out + "/recovery-results.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await b.close();
}
