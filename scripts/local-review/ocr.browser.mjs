// Real OCR, synthetic images, isolated Chrome. Never opens the owner's browser profile.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:5318",
  out = "/private/tmp/yorisoi-ocr-review";
const health = await fetch(base + "/__review/health").then((r) => r.json());
assert.ok(health.ready && health.synthetic && !health.external);
await fs.mkdir(out, { recursive: true });
const b = await chromium.launch({ channel: "chrome", headless: true });
const browserCDP = await b.newBrowserCDPSession();
const results = [];
const expected = [
  "今週、少し話せる？",
  "予定を確認してみるね。",
  "無理なら返事はしなくて大丈夫。",
];
function distance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = d[j];
      d[j] = Math.min(
        d[j] + 1,
        d[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = old;
    }
  }
  return d[b.length];
}
const norm = (s) => s.normalize("NFKC").replace(/\s/g, "");
try {
  for (const width of [1440, 390]) {
    const c = await b.newContext({ viewport: { width, height: 960 } });
    c.setDefaultTimeout(20000);
    let external = 0,
      posts = 0;
    await c.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== base) {
        external++;
        return r.abort();
      }
      if (r.request().method() === "POST") posts++;
      return r.continue();
    });
    await c.request.post(base + "/__review/scenario", {
      headers: {
        origin: base,
        "content-type": "application/x-www-form-urlencoded",
      },
      data: "mode=free",
    });
    const p = await c.newPage();
    await p.goto(base + "/consult");
    await p.locator("#chat-text").fill("元の相談の下書き");
    await p.locator("#screenshot-import summary").click();
    for (const kind of ["light", "dark", "tiny"]) {
      const image = await p.evaluate(
        ({ kind, expected }) => {
          const c = document.createElement("canvas");
          c.width = 800;
          c.height = 640;
          const x = c.getContext("2d");
          const dark = kind === "dark";
          x.fillStyle = dark ? "#181b20" : "#f1f0e9";
          x.fillRect(0, 0, 800, 640);
          x.fillStyle = dark ? "#fff" : "#182b23";
          x.font = "24px sans-serif";
          x.fillText("合成の名前・アイコン", 30, 40);
          const size = kind === "tiny" ? 9 : 28;
          x.font = `${size}px sans-serif`;
          const lines = [
            ...expected,
            "ありがとう🙂 19:35",
            "昨日は会えた。",
            "今日はまだ会っていない。",
          ];
          lines.forEach((t, i) => {
            const left = i % 2 === 0 ? 30 : 160;
            x.fillStyle = dark ? "#283b32" : "#fff";
            x.fillRect(left, 80 + i * 85, 610, 65);
            x.fillStyle =
              kind === "tiny" ? "#bbbbbb" : dark ? "#fff" : "#182b23";
            x.fillText(t, left + 12, 120 + i * 85);
          });
          return c.toDataURL("image/png").split(",")[1];
        },
        { kind, expected },
      );
      await p.locator("#screenshot-import input[type=file]").setInputFiles({
        name: kind + ".png",
        mimeType: "image/png",
        buffer: Buffer.from(image, "base64"),
      });
      await p.getByLabel("高さ（%）").fill("10");
      await p.getByRole("button", { name: "この範囲を黒く隠す" }).click();
      const mask = await p
        .locator("#screenshot-import canvas")
        .evaluate((e) =>
          Array.from(e.getContext("2d").getImageData(20, 20, 1, 1).data),
        );
      assert.deepEqual(mask, [17, 17, 17, 255]);
      let peak = 0;
      const mem = setInterval(async () => {
        try {
          const { processInfo } = await browserCDP.send(
            "SystemInfo.getProcessInfo",
          );
          const ids = new Set(processInfo.map((p) => p.id));
          const rss = execFileSync("ps", ["-axo", "pid=,rss="], {
            encoding: "utf8",
          })
            .trim()
            .split("\n")
            .reduce((sum, l) => {
              const [pid, n] = l.trim().split(/\s+/).map(Number);
              return sum + (ids.has(pid) ? n : 0);
            }, 0);
          peak = Math.max(peak, rss);
        } catch {}
      }, 200);
      await p.evaluate(() => {
        window.__ticks = [];
        let last = performance.now();
        window.__timer = setInterval(() => {
          let t = performance.now();
          window.__ticks.push(t - last);
          last = t;
        }, 50);
      });
      const t = Date.now();
      await p
        .getByRole("button", { name: "端末内で読み取る", exact: true })
        .click();
      await p.waitForFunction(
        () => !document.querySelector("#screenshot-import fieldset").disabled,
        null,
        { timeout: 125000 },
      );
      clearInterval(mem);
      const ms = Date.now() - t;
      const responsiveness = await p.evaluate(() => {
        clearInterval(window.__timer);
        return {
          ticks: window.__ticks.length,
          maxGapMs: Math.max(0, ...window.__ticks),
        };
      });
      const rows = await p
        .locator(".quote-row textarea")
        .evaluateAll((es) => es.map((e) => e.value));
      assert.ok(rows.length > 0);
      assert.equal(
        await p.locator("#chat-text").inputValue(),
        "元の相談の下書き",
      );
      assert.ok(!rows.join("").includes("合成の名前"));
      const known = expected.map((s) => ({
        expected: s,
        nearest: rows.reduce(
          (best, r) =>
            distance(norm(s), norm(r)) < distance(norm(s), norm(best))
              ? r
              : best,
          rows[0],
        ),
      }));
      known.forEach((x) => {
        x.editDistance = distance(norm(x.expected), norm(x.nearest));
        x.characters = norm(x.expected).length;
      });
      assert.ok(
        (
          await p
            .locator(".quote-row select")
            .evaluateAll((es) => es.map((e) => e.value))
        ).every((v) => v === "unknown"),
      );
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await p.locator(".quote-row").first().scrollIntoViewIfNeeded();
      await p.screenshot({ path: `${out}/ocr-${kind}-${width}.png` });
      results.push({
        width,
        kind,
        rows,
        known,
        ms,
        peakBrowserProcessRssKiB: peak,
        responsiveness,
        external,
        posts,
      });
    }
    // Manual correction and draft append; low confidence is never silently fixed.
    const rows = p.locator(".quote-row");
    const n = await rows.count();
    for (let i = n - 1; i > 0; i--)
      await p
        .getByRole("button", { name: `発言${i + 1}を削除`, exact: true })
        .click();
    await p.getByLabel("発言 1 の人").selectOption("me");
    await p.getByLabel("発言 1 の本文").fill("予定を確認してみるね。");
    await p.getByLabel("発言者・順番・重複・不明箇所を確認しました").check();
    await p
      .getByLabel("発言 1 の本文")
      .fill("予定を確認してみるね。無理はしないでね。");
    assert.equal(
      await p
        .getByLabel("発言者・順番・重複・不明箇所を確認しました")
        .isChecked(),
      false,
    );
    await p.getByLabel("発言者・順番・重複・不明箇所を確認しました").check();
    await p
      .getByRole("button", { name: "確認した会話を下書きへ追加", exact: true })
      .click();
    assert.match(
      await p.locator("#chat-text").inputValue(),
      /^元の相談の下書き/,
    );
    assert.match(
      await p.locator("#chat-text").inputValue(),
      /無理はしないでね/,
    );
    assert.equal(posts, 0);
    const draft = await p.locator("#chat-text").inputValue();
    await p
      .getByRole("button", { name: "合成画像を用意する", exact: true })
      .click();
    await p
      .getByRole("button", { name: "端末内で読み取る", exact: true })
      .click();
    await p
      .getByRole("button", { name: "読み取りを中断する", exact: true })
      .click();
    await expect(p.locator("#screenshot-import fieldset")).toBeEnabled();
    assert.equal(await p.locator("#chat-text").inputValue(), draft);
    assert.equal(external, 0);
    await c.close();
  }
  await fs.writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      results.map(
        ({
          width,
          kind,
          ms,
          peakBrowserProcessRssKiB,
          responsiveness,
          external,
          posts,
          known,
        }) => ({
          width,
          kind,
          ms,
          peakBrowserProcessRssKiB,
          responsiveness,
          external,
          posts,
          known,
        }),
      ),
    ),
  );
} finally {
  await b.close();
}
