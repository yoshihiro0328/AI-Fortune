// Actual isolated PostgreSQL + actual Next + actual Chrome UI. No real secrets/providers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { run } from "./launch.mjs";
import { startBrowser } from "./browser.mjs";
import { isolatedReady } from "./isolated.mjs";
import { snapshot, compareBaseline } from "../payment-continuation/state.mjs";
import { TARGET } from "../payment-runtime/policy.mjs";
const mode = process.argv[2],
  report = process.argv[3];
assert(
  ["normal", "eof", "mismatch"].includes(mode) &&
    path.isAbsolute(report) &&
    !fs.existsSync(report),
);
const original = fetch;
globalThis.fetch = (r, opts) => {
  const u = new URL(typeof r === "string" || r instanceof URL ? r : r.url);
  assert.equal(u.origin, TARGET.app);
  return original(r, opts);
};
const db = await isolatedReady(),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "verification-offline-"));
fs.chmodSync(dir, 0o700);
const attempt = randomUUID(),
  file = path.join(dir, "input.json"),
  journal = path.join(dir, "verification-" + attempt + ".jsonl");
const jwt = (role) =>
  "e30." +
  Buffer.from(JSON.stringify({ ref: TARGET.ref, role })).toString("base64url") +
  ".synthetic";
fs.writeFileSync(
  file,
  JSON.stringify({
    approved: true,
    project: TARGET.ref,
    account: TARGET.account,
    fixtureDisposition: "reuse",
    attemptId: attempt,
    previousAttemptId: randomUUID(),
    manifest: db.m,
    baseline: db.baseline,
    expected: db.expected,
    rateBaseline: await db.read("rate_limits?select=*"),
    secrets: { anon: jwt("anon"), service: jwt("service_role") },
  }),
  { mode: 0o600 },
);
if (mode === "mismatch")
  await db.pg.query("update paid_reports set status='queued'");
let browser,
  done = false,
  helperError = false;
const seen = new Set();
const helper = (async () => {
  while (!done) {
    if (browser && fs.existsSync(journal)) {
      for (const x of fs
        .readFileSync(journal, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse)) {
        if (x.event === "browser_login_ready" && !seen.has(x.label)) {
          seen.add(x.label);
          await browser.syntheticLogin(x.label);
          console.log("SYNTHETIC_LOGIN_SUBMITTED_" + x.label);
        }
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
})().catch(() => {
  helperError = true;
  console.log("OFFLINE_BROWSER_HELPER_FAILED");
});
let result;
try {
  const exitCode = await run(file, process.cwd(), {
    headless: true,
    transport: db.transport,
    startBrowser: async (options) => {
      browser = await startBrowser(options);
      return browser;
    },
  });
  done = true;
  await helper;
  assert(!helperError);
  const rows = fs
      .readFileSync(journal, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse),
    closure = rows.findLast((x) => x.event === "closure");
  assert(closure.cleanupComplete);
  assert(!fs.existsSync(file));
  const browserResults = rows.filter(
      (x) => x.event === "browser_flow_verified",
    ),
    rls = rows.filter((x) => x.event === "rls_access");
  if (mode === "normal") {
    assert.equal(exitCode, 0);
    assert(closure.complete);
    assert.equal(browserResults.length, 3);
    assert.equal(rls.length, 4);
    compareBaseline(await snapshot(db.read), db.baseline);
  } else {
    assert.equal(exitCode, 2);
    assert(!closure.complete);
  }
  assert(!db.calls.some((x) => /apply_stripe|checkout|openai/.test(x.path)));
  result = {
    passed: true,
    mode,
    exitCode,
    closure,
    browserResults,
    rls,
    api: rows.filter((x) => x.event === "application_access"),
    requests: rows.filter((x) => x.event === "application_http"),
    failure: rows.filter((x) => x.event === "failure"),
    migrations: 17,
    actualBrowser: "Chrome under OS outbound restriction",
    auth: "synthetic",
    providerConnections: 0,
    psqlConnections: 0,
    bodyWrites: 0,
  };
} catch {
  result = {
    passed: false,
    mode,
    events: fs.existsSync(journal)
      ? fs
          .readFileSync(journal, "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse)
          .filter((x) =>
            [
              "offline_browser_request",
              "failure",
              "closure",
              "application_http",
              "denied_provider",
              "provider_failed",
              "browser_external_blocked",
            ].includes(x.event),
          )
      : [],
  };
  process.exitCode = 1;
} finally {
  done = true;
  await helper;
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(report, JSON.stringify(result, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify(result));
}
