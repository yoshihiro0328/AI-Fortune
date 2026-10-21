// Synthetic-only browser regression. Never attach to an existing browser,
// use real credentials, take screenshots, or record request bodies.
import "../payment-ci-guard.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { receiverSession, SECRET_WINDOW_MS } from "./receiver-session.mjs";
import { assembleHandoff } from "./private-handoff.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "plus-form-browser-"));
fs.chmodSync(directory, 0o700);
let receiver, browser;
try {
  let time = Date.now();
  receiver = await receiverSession({ directory, now: () => time });
  time += 7 * 24 * 60 * 60 * 1000;
  assert.equal((await receiver.beforeCreate()).remainingMs, SECRET_WINDOW_MS);
  fs.writeFileSync(
    path.join(directory, "base-credentials.json"),
    JSON.stringify({
      anon: "synthetic",
      service: "synthetic",
      cPassword: "synthetic-c",
      dPassword: "synthetic-d",
      vaultKey: Buffer.alloc(32, 1).toString("base64"),
    }),
    { mode: 0o600 },
  );
  const origin = new URL(receiver.url).origin;
  const port = new URL(receiver.url).port;
  let executablePath;
  if (process.platform === "darwin") {
    executablePath = path.join(directory, "synthetic-browser.sh");
    fs.writeFileSync(
      executablePath,
      `#!/bin/sh
exec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:${port}"))' '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' "$@"
`,
      { mode: 0o700 },
    );
  }
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
    ],
    env: { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory },
  });
  const context = await browser.newContext({ serviceWorkers: "block" });
  let blocked = 0;
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    blocked++;
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(receiver.url);
  const values = {
    listener: "rk_test_" + "a".repeat(32),
    app: "rk_test_" + "b".repeat(32),
    lifecycle: "rk_test_" + "c".repeat(32),
  };
  for (const [name, value] of Object.entries(values))
    await page.locator(`input[name="${name}"]`).fill(value);
  const responsePromise = page.waitForResponse(
    (r) => r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "3件を安全に渡す" }).click();
  const response = await responsePromise;
  assert.equal(
    response.request().headers().origin,
    origin,
    "native form must preserve its origin",
  );
  assert.equal(response.status(), 200, "native browser form must be accepted");
  await page
    .getByRole("heading", { name: "安全に受け取りました", exact: true })
    .waitFor();
  assert.equal(receiver.status().received, true);
  assert.equal(receiver.status().failed, false);
  assert.equal(receiver.status().remainingMs, SECRET_WINDOW_MS);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(directory, "stripe-keys.json"))),
    values,
  );
  await page.reload();
  assert.equal(await page.locator("input").count(), 0);
  assert.equal(blocked, 0, "form must need no external resources");
  await receiver.handoff();
  const assembled = assembleHandoff(directory);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(assembled))).length, 8);
  assert(!fs.existsSync(path.join(directory, "stripe-keys.json")));
  console.log(
    "PASS: synthetic owner wait, live probe, native form, private handoff ready for startup",
  );
} finally {
  await browser?.close();
  await receiver?.close("test_finished");
  fs.rmSync(directory, { recursive: true, force: true });
}
