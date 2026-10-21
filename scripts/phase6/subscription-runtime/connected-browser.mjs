import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { TARGET } from "./policy.mjs";
// Local regression adapter only. Never used with real credentials or hosted Stripe.
export async function connectedBrowser({ runtime, m, pay, cancel }) {
  assert.equal(m.synthetic, true);
  const wrapper = path.join(runtime.dir, "synthetic-chrome.sh");
  fs.writeFileSync(
    wrapper,
    `#!/bin/sh
exec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:5218"))' '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "$@"
`,
    { mode: 0o700 },
  );
  const browser = await chromium.launch({
    executablePath: wrapper,
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
    ],
    env: { PATH: "/usr/bin:/bin", HOME: runtime.dir, TMPDIR: runtime.dir },
  });
  let helperFailed = false;
  runtime.app.on("message", (message) => {
    if (message?.pay)
      pay(message.pay)
        .then(() => runtime.app.send({ paid: message.pay }))
        .catch(() => {
          helperFailed = true;
        });
    if (message?.portalCancel)
      cancel()
        .then(() => runtime.app.send({ portalCanceled: true }))
        .catch(() => {
          helperFailed = true;
        });
  });
  const traces = [];
  async function page() {
    const context = await browser.newContext({
      serviceWorkers: "block",
      locale: "ja-JP",
    });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === TARGET.app) return route.continue();
      if (/^https:\/\/billing\.stripe\.com\/synthetic\/[12]$/.test(url.href))
        return route.fulfill({
          status: 302,
          headers: {
            location:
              TARGET.app +
              "/__subscription/portal?session=" +
              url.pathname.split("/").at(-1),
          },
        });
      return route.abort();
    });
    const p = await context.newPage();
    p.setDefaultTimeout(30000);
    p.on("response", (r) =>
      traces.push({ path: new URL(r.url()).pathname, status: r.status() }),
    );
    return p;
  }
  const c = await page(),
    d = await page(),
    anon = await page();
  async function login(p, user, letter) {
    await p.goto(TARGET.app + "/subscription-test/" + letter);
    await p.locator("#email").fill(user.email);
    await p.locator("#password").fill("SyntheticOnly123!");
    await p.getByRole("button", { name: "ログイン", exact: true }).click();
    await p
      .getByRole("heading", { name: "保存した診断", exact: true })
      .waitFor();
    await p.getByText("残り", { exact: false }).first().waitFor();
  }
  async function checkout() {
    await c.goto(TARGET.app + "/plans");
    await c.getByRole("checkbox").check();
    await c
      .getByRole("button", { name: "Plusのテスト契約へ", exact: true })
      .click();
    await c
      .getByRole("heading", { name: "ローカル代替 Checkout：980 JPY／月" })
      .waitFor();
  }
  async function payOnce() {
    await c.getByRole("button", { name: "合成テスト支払い" }).click();
    await c.waitForURL("**/account?subscription=complete");
    await c.getByRole("heading", { name: "契約状況" }).waitFor();
  }
  async function denials() {
    await d.goto(TARGET.app + "/plans");
    await d.getByRole("checkbox").check();
    await d
      .getByRole("button", { name: "Plusのテスト契約へ", exact: true })
      .click();
    await d.getByRole("alert").waitFor();
    await anon.goto(TARGET.app + "/plans");
    for (const [p, status] of [
      [d, 403],
      [anon, 401],
    ])
      for (const action of ["checkout", "portal", "cancel"]) {
        const result = await p.evaluate(async (action) => {
          const res = await fetch("/api/billing", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, consent: true }),
          });
          return res.status;
        }, action);
        assert.equal(result, status);
      }
  }
  return {
    async checkpoint(data) {
      assert(!helperFailed);
      switch (data.checkpoint) {
        case "logins":
          await login(c, m.c, "c");
          await login(d, m.d, "d");
          break;
        case "checkout-first-display":
          await checkout();
          break;
        case "portal-first-return": {
          const p = await c.context().newPage();
          await p.goto(data.url);
          await p
            .getByRole("heading", { name: "ローカル代替 Customer Portal" })
            .waitFor();
          assert.equal(
            await p.getByRole("button", { name: /期間末で解約/ }).count(),
            0,
          );
          await p.getByRole("link", { name: "よりそいへ戻る" }).click();
          await p
            .getByRole("heading", { name: "保存した診断", exact: true })
            .waitFor();
          await p.close();
          break;
        }
        case "pay-first-once":
          await payOnce();
          break;
        case "pay-second-once":
          await checkout();
          await payOnce();
          break;
        case "minimal-plus-and-portal-return":
          await c.goto(TARGET.app + "/account");
          await c.getByText("Plus", { exact: false }).first().waitFor();
          await c
            .getByRole("button", { name: "解約・支払い方法・請求履歴" })
            .click();
          await c
            .getByRole("heading", { name: "ローカル代替 Customer Portal" })
            .waitFor();
          assert.equal(
            await c.getByRole("button", { name: /期間末で解約/ }).count(),
            0,
          );
          await c.getByRole("link", { name: "よりそいへ戻る" }).click();
          await c.getByRole("heading", { name: "契約状況" }).waitFor();
          await denials();
          break;
        case "portal-second-cancel-once-return":
          await c.goto(TARGET.app + "/account");
          await c
            .getByRole("button", { name: "解約・支払い方法・請求履歴" })
            .click();
          await c
            .getByRole("heading", { name: "ローカル代替 Customer Portal" })
            .waitFor();
          await c
            .getByRole("button", { name: "期間末で解約する（ローカル代替）" })
            .click();
          await c.getByText("解約予約済み", { exact: false }).waitFor();
          break;
        case "account-and-denials":
          await c.goto(TARGET.app + "/account");
          await c.getByText("解約済み", { exact: false }).waitFor();
          await denials();
          break;
        default:
          assert.fail("unknown browser checkpoint");
      }
      assert(!helperFailed);
      return { checkpoint: data.checkpoint, observed: true };
    },
    traces: () => traces,
    close: () => browser.close(),
  };
}
