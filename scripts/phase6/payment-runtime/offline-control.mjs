// Interactive acceptance harness only. No runtime.json, real manifest, key,
// original fixture or provider network is accessed. Not a hosted execution mode.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { run, copyApplication } from "./launch.mjs";
import { isolatedPayment } from "./preflight-isolated.mjs";
import { startBroker } from "./broker.mjs";
import { startApp, startListener, stopChild, waitReady } from "./processes.mjs";
import { TARGET, hash } from "./policy.mjs";

const scenario = process.argv[2],
  report = process.argv[3];
assert(["finish", "eof", "hangup", "pipe"].includes(scenario));
assert(report && path.isAbsolute(report) && !fs.existsSync(report));
// Provider operations use embedded PostgreSQL only. Any unexpected parent
// fetch outside loopback is refused before network I/O.
const localFetch = globalThis.fetch;
let rejectedFetches = 0;
globalThis.fetch = (input, options) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (
    !["http://127.0.0.1:5208", "http://127.0.0.1:5209"].includes(url.origin)
  ) {
    rejectedFetches++;
    throw Error("OFFLINE_EXTERNAL_FETCH_DENIED");
  }
  return localFetch(input, options);
};
const start = Date.now();
const db = await isolatedPayment();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-control-offline-"));
fs.chmodSync(dir, 0o700);
const input = path.join(dir, "input"),
  binary = path.join(dir, "fake-cli");
fs.writeFileSync(
  binary,
  '#!/bin/sh\nprintf "Ready whsec_syntheticOnly\\n"\nexec /bin/sleep 1800\n',
  { mode: 0o700 },
);
const jwt = (role) =>
  [
    "e30",
    Buffer.from(JSON.stringify({ ref: TARGET.ref, role })).toString(
      "base64url",
    ),
    "synthetic",
  ].join(".");
const attemptId = randomUUID();
fs.writeFileSync(
  input,
  JSON.stringify({
    approved: true,
    purchasePreflightVerified: true,
    cliPermissionsVerified: true,
    project: TARGET.ref,
    account: TARGET.account,
    fixtureDisposition: "reuse",
    attemptId,
    previousAttemptId: db.manifest.run,
    manifest: db.manifest,
    cli: binary,
    cliSha256: hash(fs.readFileSync(binary)),
    secrets: {
      anon: jwt("anon"),
      service: jwt("service_role"),
      stripe: "rk_test_syntheticApp",
      listener: "rk_test_syntheticListener",
    },
  }),
  { mode: 0o600 },
);
let broker, policy, appDir, readyAt;
const children = [];
const snapshot = async () =>
  JSON.stringify(
    (
      await db.pg.query(
        "select jsonb_build_object('diagnoses',(select jsonb_agg(to_jsonb(d)) from diagnoses d),'answers',(select jsonb_agg(to_jsonb(a)) from diagnosis_answers a),'reports',(select jsonb_agg(to_jsonb(f)) from free_reports f),'profiles',(select jsonb_agg(to_jsonb(p) order by id) from profiles p),'users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u)) as state",
      )
    ).rows,
  );
const before = await snapshot();
let result;
try {
  const runtimeExitCode = await run(input, process.cwd(), {
    // Same real process.stdin as hosted launch; no PassThrough, keepalive or
    // auto-finish injection. exec_command must supply tty:true, then write_stdin.
    providerTransport: () => db.transport,
    startBroker: async (options) => {
      policy = options.policy;
      broker = await startBroker(options);
      return broker;
    },
    startListener: (options) => {
      const p = startListener(options);
      children.push(p.child);
      return p;
    },
    copyApplication: (repo, destination) => {
      appDir = destination;
      copyApplication(repo, destination);
    },
    startApp: (options) => {
      const child = startApp(options);
      children.push(child);
      return child;
    },
    waitReady: async (child) => {
      await waitReady(child);
      readyAt = Date.now();
    },
  });
  const rows = fs
    .readFileSync(path.join(dir, `payment-${attemptId}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const closure = rows.find((r) => r.event === "closure");
  const ready = rows.find((r) => r.event === "ready");
  const status = rows.filter((r) => r.event === "control_status");
  const expected = {
    finish: "operator_finished",
    eof: "input_closed",
    hangup: "input_hangup",
    pipe: "execution_failed",
  }[scenario];
  assert.equal(closure.reason, expected);
  assert.equal(runtimeExitCode, 2); // Mock keys remain pending; never claim real revocation.
  assert.equal(closure.processes, "stopped");
  assert.equal(closure.temporary, "deleted");
  assert.equal(closure.price, "verified_inactive");
  assert.equal(closure.complete, false);
  assert(!fs.existsSync(input) && (!appDir || !fs.existsSync(appDir)));
  assert(children.every((c) => c.exitCode !== null || c.signalCode !== null));
  assert(!broker || !broker.server.listening);
  assert(!policy || policy.stopped);
  assert.equal(
    (
      await db.pg.query(
        "select count(*)::int n from price_versions where active",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(await snapshot(), before);
  assert(
    !db.calls.some(
      (r) => ["POST", "DELETE"].includes(r.method) || r.path.includes("/auth/"),
    ),
  );
  if (scenario === "pipe") {
    assert(!ready);
    assert(rows.some((r) => r.errorCode === "INTERACTIVE_INPUT_REQUIRED"));
  } else {
    assert(ready);
    assert(status.length >= 1);
    assert(
      status.every(
        (s) =>
          s.ready &&
          s.applicationAlive &&
          s.listenerAlive &&
          s.brokerListening &&
          !s.stopping,
      ),
    );
  }
  assert.equal(rejectedFetches, 0);
  result = {
    passed: true,
    scenario,
    at: new Date().toISOString(),
    inputIsTTY: process.stdin.isTTY === true,
    runtimeExitCode,
    readyReached: !!ready,
    readyDurationMs: readyAt ? Date.now() - readyAt : 0,
    elapsedMs: Date.now() - start,
    statusObservations: status.map((s) => ({
      at: s.at,
      ready: s.ready,
      applicationAlive: s.applicationAlive,
      listenerAlive: s.listenerAlive,
      brokerListening: s.brokerListening,
    })),
    stopReason: closure.reason,
    processesStopped: true,
    temporaryRemoved: true,
    isolatedPriceInactive: true,
    fixtureUnchanged: true,
    isolatedMigrations: db.migrations.length,
    authAndCheckoutRequests: 0,
    realCredentialsUsed: false,
    providerConnections: 0,
    parentUnexpectedFetches: rejectedFetches,
    realKeyRevocation: "not_executed",
  };
} catch {
  result = {
    passed: false,
    scenario,
    error: "OFFLINE_ACCEPTANCE_FAILED",
    at: new Date().toISOString(),
  };
  process.exitCode = 1;
} finally {
  for (const child of children) await stopChild(child);
  if (broker?.server.listening) await broker.stop();
  await db.pg.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(report, JSON.stringify(result, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify(result));
}
