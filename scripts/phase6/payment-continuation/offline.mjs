// Actual continuation launcher + actual Next HTTP handlers + 17-migration PGlite.
// Auth issuance is synthetic. No hosted credentials, Stripe CLI or provider access.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { run } from "./launch.mjs";
import { isolatedPaid } from "./isolated.mjs";
import {
  snapshot,
  verifyAfter,
  reportBody,
  compareBaseline,
} from "./state.mjs";
import { TARGET, hash } from "../payment-runtime/policy.mjs";
const mode = process.argv[2],
  report = process.argv[3];
assert(
  ["finish", "eof", "failure", "preflight", "pipe"].includes(mode) &&
    report &&
    path.isAbsolute(report) &&
    !fs.existsSync(report),
);
const originalFetch = globalThis.fetch;
let rejected = 0;
globalThis.fetch = (input, opts) => {
  const u = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (
    ![
      "http://localhost:5208",
      "http://127.0.0.1:5208",
      "http://127.0.0.1:5209",
    ].includes(u.origin)
  ) {
    rejected++;
    throw Error("OFFLINE_NETWORK_BLOCKED");
  }
  return originalFetch(input, opts);
};
const db = await isolatedPaid(),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "continuation-offline-"));
fs.chmodSync(dir, 0o700);
const attempt = randomUUID(),
  file = path.join(dir, "input.json"),
  journal = path.join(dir, "continuation-" + attempt + ".jsonl");
const jwt = (role) =>
  [
    "e30",
    Buffer.from(JSON.stringify({ ref: TARGET.ref, role })).toString(
      "base64url",
    ),
    "synthetic",
  ].join(".");
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
    secrets: { anon: jwt("anon"), service: jwt("service_role") },
    database: {
      binary: "/not-used-offline",
      binarySha256: "synthetic",
      ca: "/not-used-offline",
      caSha256: "synthetic",
      password: "synthetic",
    },
  }),
  { mode: 0o600 },
);
if (mode === "preflight")
  await db.pg.query("update payments set status='refunded'");
let sqlCount = 0,
  executedSqlHash,
  apiChecks = [],
  helperStop = false,
  helperError = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const request = async (jar, p, opts = {}) => {
  const r = await fetch(TARGET.app + p, {
    ...opts,
    headers: {
      ...opts.headers,
      host: "localhost:5208",
      origin: TARGET.app,
      cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  for (const s of r.headers.getSetCookie()) {
    const [pair] = s.split(";"),
      i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return r;
};
const helper = (async () => {
  if (mode !== "finish") return;
  while (!helperStop) {
    if (
      fs.existsSync(journal) &&
      fs.readFileSync(journal, "utf8").includes('"body_verified"')
    )
      break;
    await sleep(100);
  }
  if (helperStop) return;
  const a = new Map(),
    b = new Map();
  for (const [label, user, jar] of [
    ["a", db.m.a, a],
    ["b", db.m.b, b],
  ]) {
    assert.equal(
      (await request(jar, "/payment-test/start/" + label)).status,
      303,
    );
    const r = await request(jar, "/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "login",
        email: user.email,
        password: "SyntheticOnly123!",
      }),
    });
    assert.equal(r.status, 200, await r.text());
    apiChecks.push("real API synthetic login " + label);
  }
  for (const p of [
    "/api/diagnoses/" + db.m.diagnosis + "/checkout",
    "/api/webhooks/stripe",
    "/api/diagnoses/" + db.m.diagnosis + "/report",
  ]) {
    assert.equal(
      (await request(a, p, { method: "POST", body: "{}" })).status,
      403,
    );
    apiChecks.push("denied " + p.split("/").pop());
  }
  // Prove a direct listener route is absent and cannot cause forwarding.
  const denied = await fetch("http://127.0.0.1:5209/webhook", {
    method: "POST",
    body: "{}",
  });
  assert.equal(denied.status, 403);
  apiChecks.push("no webhook ingress");
  console.log(
    "OFFLINE A/B synthetic login complete. Now status, verify, then finish.",
  );
})().catch((e) => {
  helperError = e.message;
  console.log("OFFLINE_HELPER_FAILED", e.message);
});
let result;
try {
  const exitCode = await run(file, process.cwd(), {
    transport: db.transport,
    executeBody: async (sql, _c, _d, record) => {
      sqlCount++;
      executedSqlHash = hash(sql);
      record("body_send_reserved", {
        sha256: executedSqlHash,
        count: sqlCount,
      });
      assert.equal(sqlCount, 1);
      if (mode === "failure") {
        try {
          await db.pg.exec(
            sql.replace(
              "END $continuation$;",
              "RAISE EXCEPTION 'injected'; END $continuation$;",
            ),
          );
        } catch {
          await db.pg.exec("rollback");
          throw Error("INJECTED_BODY_FAILURE");
        }
      } else await db.pg.exec(sql);
      record("body_commit", {
        exitCode: 0,
        commitResponse: true,
        adapter: "isolated_postgres",
      });
      return { exitCode: 0, commitResponse: true };
    },
  });
  helperStop = true;
  await helper;
  assert.equal(helperError, null);
  const rows = fs
      .readFileSync(journal, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse),
    closure = rows.findLast((x) => x.event === "closure");
  assert(closure.cleanupComplete);
  assert(!fs.existsSync(file));
  const after = await snapshot(db.read);
  if (mode === "finish") {
    assert.equal(exitCode, 0);
    assert(closure.complete && closure.bodyDone && closure.verified);
    assert.equal(sqlCount, 1);
    verifyAfter(db.baseline, after, reportBody(process.cwd()));
    assert.equal(
      rows.filter((x) => x.event === "application_access").length,
      3,
    );
    assert.deepEqual(
      rows.filter((x) => x.event === "rls_access").map((x) => [x.user, x.rows]),
      [
        ["A", 1],
        ["A", 1],
        ["B", 0],
        ["B", 0],
      ],
    );
    assert.equal(
      rows.find((x) => x.event === "body_attempt_reserved").sha256,
      executedSqlHash,
    );
  } else {
    assert.equal(exitCode, 2);
    assert(!closure.complete);
    if (mode === "failure") {
      assert.equal(sqlCount, 1);
      compareBaseline(after, db.baseline);
    }
    if (["eof", "pipe", "preflight"].includes(mode)) assert.equal(sqlCount, 0);
  }
  assert(
    !db.calls.some((x) =>
      /\/v1\/(checkout|payment_intents)|\/webhook|rpc\/apply_stripe|openai/.test(
        x.path,
      ),
    ),
  );
  assert.equal(rejected, 0);
  result = {
    passed: true,
    scenario: mode,
    at: new Date().toISOString(),
    exitCode,
    closure,
    sqlCount,
    exactSqlHashMatched: mode === "finish",
    apiChecks,
    rlsObservations: rows
      .filter((x) => x.event === "rls_access")
      .map(({ user, table, rows }) => ({ user, table, rows })),
    applicationAccess: rows
      .filter((x) => x.event === "application_access")
      .map(({ user, httpStatus, bodyReturned }) => ({
        user,
        httpStatus,
        bodyReturned,
      })),
    migrations: 17,
    auth: "synthetic issuance only",
    realNextHandlers: true,
    rls: "real isolated PostgreSQL policies",
    providerConnections: 0,
    realCredentials: false,
  };
} catch (e) {
  result = { passed: false, scenario: mode, error: e.message };
  process.exitCode = 1;
} finally {
  helperStop = true;
  await helper;
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(report, JSON.stringify(result, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify(result));
}
