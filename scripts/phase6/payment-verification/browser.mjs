import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { isDeepStrictEqual } from "node:util";
import { TARGET, insist } from "../payment-runtime/policy.mjs";
export async function startBrowser({
  dir,
  manifest,
  body,
  record,
  onStop,
  headless = false,
}) {
  const executable =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  insist(fs.existsSync(executable), "CHROME_REQUIRED");
  const wrapper = path.join(dir, "verification-browser.sh");
  fs.writeFileSync(
    wrapper,
    `#!/bin/sh\nexec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:5208"))' '${executable}' "$@"\n`,
    { mode: 0o700, flag: "wx" },
  );
  const browser = await chromium.launch({
    executablePath: wrapper,
    headless,
    timeout: 30000,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--no-first-run",
    ],
    env: { PATH: "/usr/bin:/bin", HOME: dir, TMPDIR: dir },
  });
  let closing = false;
  browser.on("disconnected", () => {
    if (!closing) onStop("browser_disconnected");
  });
  const tabs = new Map(),
    observations = new Map();
  async function pageFor(label) {
    insist(!tabs.has(label), "BROWSER_ALREADY_OPENED");
    const context = await browser.newContext({
      serviceWorkers: "block",
      locale: "ja-JP",
    });
    const page = await context.newPage();
    if (headless)
      page.on("request", (r) =>
        record("offline_browser_request", {
          method: r.method(),
          path: new URL(r.url()).pathname.replace(
            manifest.diagnosis,
            ":diagnosis",
          ),
        }),
      );
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);
    const o = {
      loginPosts: 0,
      loginStatus: null,
      listAfterLogin: null,
      reportStatus: null,
      reportMatches: false,
    };
    observations.set(label, o);
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== TARGET.app) {
        record("browser_external_blocked", { label });
        onStop("browser_external_request");
        await route.abort();
        return;
      }
      await route.continue();
    });
    page.on("response", async (r) => {
      try {
        const u = new URL(r.url()),
          method = r.request().method();
        if (u.pathname === "/api/auth" && method === "POST") {
          o.loginPosts++;
          o.loginStatus = r.status();
          record("browser_login_response", {
            label,
            httpStatus: r.status(),
            count: o.loginPosts,
          });
          if (r.status() !== 200 || o.loginPosts > 1)
            onStop("browser_auth_failed_or_unknown");
        }
        if (u.pathname === "/api/diagnoses" && o.loginStatus === 200) {
          const data = await r.json();
          insist(
            r.status() === 200 && Array.isArray(data),
            "BROWSER_LIST_FAILED",
          );
          o.listAfterLogin = data;
        }
        if (u.pathname === `/api/diagnoses/${manifest.diagnosis}/report`) {
          o.reportStatus = r.status();
          const data = await r.json();
          o.reportMatches = isDeepStrictEqual(data.report, body);
          o.bodyPresent = !!data.report;
        }
      } catch {
        onStop("browser_response_unknown");
      }
    });
    tabs.set(label, { page, context });
    return page;
  }
  const wait = async (page, fn) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await page.waitForTimeout(100);
    }
    throw Error("BROWSER_OBSERVATION_MISSING");
  };
  return {
    alive: () => browser.isConnected(),
    async open(label) {
      insist(["A", "B"].includes(label));
      const page = await pageFor(label);
      await page.goto(
        TARGET.app + "/payment-test/start/" + label.toLowerCase(),
      );
      await page
        .getByRole("button", { name: "ログイン", exact: true })
        .waitFor({ state: "visible" });
      await page.locator("#email").fill(manifest[label.toLowerCase()].email);
      await page.bringToFront();
      record("browser_login_ready", { label });
    },
    // Only used by the isolated harness; the live driver never enters a password.
    async syntheticLogin(label) {
      insist(headless, "OFFLINE_ONLY");
      const page = tabs.get(label).page;
      await page.locator("#password").fill("SyntheticOnly123!");
      await page.getByRole("button", { name: "ログイン", exact: true }).click();
    },
    async check(label) {
      const page = tabs.get(label)?.page,
        o = observations.get(label);
      insist(page && ["A", "B"].includes(label));
      await wait(page, () => o.listAfterLogin !== null);
      insist(o.loginPosts === 1 && o.loginStatus === 200);
      await page
        .getByRole("heading", { name: "保存した診断", exact: true })
        .waitFor({ state: "visible" });
      insist(
        (await page.locator("main [role=alert]").count()) === 0,
        "ACCOUNT_UI_ERROR",
      );
      if (label === "A") {
        insist(
          o.listAfterLogin.length === 1 &&
            o.listAfterLogin[0].id === manifest.diagnosis,
          "A_LIST_MISMATCH",
        );
        await page
          .getByRole("link", { name: "詳細レポート", exact: true })
          .click();
      } else {
        insist(o.listAfterLogin.length === 0, "B_LIST_LEAK");
        await page
          .getByText("まだ診断はありません。", { exact: true })
          .waitFor({ state: "visible" });
        await page.goto(TARGET.app + "/report/" + manifest.diagnosis);
      }
      await wait(page, () => o.reportStatus !== null);
      if (label === "A") {
        insist(
          o.reportStatus === 200 && o.reportMatches,
          "A_BROWSER_BODY_FAILED",
        );
        await page
          .getByText(body.relationship_analysis, { exact: true })
          .waitFor({ state: "visible" });
        await page
          .getByRole("heading", { name: "13. 総合アドバイス", exact: true })
          .waitFor({ state: "visible" });
      } else {
        insist(
          [401, 403, 404].includes(o.reportStatus) && !o.bodyPresent,
          "B_BROWSER_BODY_LEAK",
        );
        await page
          .getByRole("heading", {
            name: "レポートを表示できませんでした",
            exact: true,
          })
          .waitFor({ state: "visible" });
        insist(
          (await page
            .getByText(body.relationship_analysis, { exact: true })
            .count()) === 0,
        );
      }
      o.checked = true;
      record("browser_flow_verified", {
        label,
        listRows: o.listAfterLogin.length,
        login: true,
        listRendered: true,
        reportRendered: label === "A",
        denialRendered: label === "B",
        reportHttpStatus: o.reportStatus,
        bodyPresent: o.bodyPresent,
      });
    },
    async anonymous() {
      const page = await pageFor("anonymous"),
        o = observations.get("anonymous");
      await page.goto(TARGET.app + "/report/" + manifest.diagnosis);
      await wait(page, () => o.reportStatus !== null);
      insist(
        [401, 403, 404].includes(o.reportStatus) && !o.bodyPresent,
        "ANON_BROWSER_BODY_LEAK",
      );
      await page
        .getByRole("heading", {
          name: "レポートを表示できませんでした",
          exact: true,
        })
        .waitFor({ state: "visible" });
      insist(
        (await page
          .getByText(body.relationship_analysis, { exact: true })
          .count()) === 0,
      );
      o.checked = true;
      record("browser_flow_verified", {
        label: "anonymous",
        denialRendered: true,
        reportHttpStatus: o.reportStatus,
        bodyPresent: false,
      });
    },
    allChecked() {
      return ["A", "B", "anonymous"].every(
        (k) => observations.get(k)?.checked === true,
      );
    },
    async stop() {
      closing = true;
      await browser.close();
      if (fs.existsSync(wrapper)) fs.unlinkSync(wrapper);
    },
  };
}
