import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { randomUUID, createHash } from "node:crypto";
import { receiverSession } from "./receiver-session.mjs";
import { privateInput, erasePrivateInputs } from "./supervisor.mjs";
import { TARGET, check } from "./policy.mjs";
import { ORIGINAL_BILLING } from "./billing-settings.mjs";
import { providerWire } from "./wire.mjs";
import { executeMonthly } from "./monthly-live.mjs";
import { testPassword } from "./test-password.mjs";
import { verifyRevocation } from "./revocation.mjs";
import {
  monthlyContinuation,
  claimMonthlyContinuation,
  monthlyCarry,
  resumedMonthlyPlan,
} from "./monthly-resume.mjs";

// Explicitly launched interactive owner. No startup external writes and no env
// credential fallback. Receipt URLs stay in a private file, never stdout.
process.umask(0o077);
const [base] = process.argv.slice(2);
check(
  process.argv.length === 3 && path.isAbsolute(base) && process.stdin.isTTY,
);
check(
  [
    "NODE_OPTIONS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ].every((k) => !process.env[k]),
);
const claimPath = path.join(base, "monthly-gf-approval-consumed.json");
check(!fs.existsSync(claimPath), "CUMULATIVE_APPROVAL_ALREADY_CONSUMED");
const run = randomUUID(),
  root = path.join(base, "private-monthly-" + run.slice(0, 8));
fs.mkdirSync(root, { mode: 0o700 });
const names = Object.fromEntries(
  ["listener", "app", "lifecycle"].map((k) => [
    k,
    `yorisoi-monthly-${run.slice(0, 8)}-${k}`,
  ]),
);
const users = Object.fromEntries(
  ["e", "f"].map((k) => {
    const id = randomUUID();
    return [
      k,
      { id, email: `plus-${run}-${id}@example.com`, password: testPassword() },
    ];
  }),
);
let seq = 0,
  closed = false,
  running = false,
  startRequested = false,
  wire,
  secrets,
  ownerResolved,
  deadlineTimer,
  forcedStop = false;
const outcomes = {
  run,
  scope: "remaining-monthly-v1",
  keyNames: names,
  closed: false,
  externalStarted: false,
  continuation: monthlyContinuation,
  cumulativeCarry: monthlyCarry,
  cumulativeLimits: resumedMonthlyPlan.limits,
};
function record(kind, value) {
  const file = path.join(root, `record-${String(++seq).padStart(5, "0")}.json`);
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ kind, value }) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
const emit = (value) => console.log(JSON.stringify(value));
const receiver = await receiverSession({ directory: root, onClosed: () => {} });
fs.writeFileSync(
  path.join(root, "input-ui.json"),
  JSON.stringify({ url: receiver.url }),
  { flag: "wx", mode: 0o600 },
);
fs.writeFileSync(path.join(root, "names.json"), JSON.stringify(names), {
  flag: "wx",
  mode: 0o600,
});
let revocationDeadline;
const interrupted = new AbortController();
async function erase() {
  if (closed) return;
  closed = true;
  clearTimeout(deadlineTimer);
  await receiver.close("stopped").catch(() => {});
  const files = ["stripe-keys.json", "input-ui.json"]
    .map((n) => path.join(root, n))
    .filter((p) => fs.existsSync(p));
  outcomes.erased = erasePrivateInputs(files, root);
  for (const v of Object.values(users)) v.password = undefined;
  if (secrets) for (const k of Object.keys(secrets)) secrets[k] = undefined;
  outcomes.closed = true;
  record("completion", outcomes);
  emit({ phase: "closed", erased: outcomes.erased });
  lines.close();
  process.stdin.pause();
}
async function execute() {
  check(!running && !closed, "ALREADY_STARTED");
  // Read-only settings observation supplied by Work, never inferred from history.
  const observation = privateInput(
    path.join(root, "billing-observation.json"),
    root,
  );
  check(
    observation.account === TARGET.account &&
      observation.livemode === false &&
      observation.source === "work-ui" &&
      Date.now() - observation.observedAt >= 0 &&
      Date.now() - observation.observedAt < 60000 &&
      Object.keys(ORIGINAL_BILLING)
        .filter((k) => k !== "graceHours")
        .every((k) => observation.settings?.[k] === ORIGINAL_BILLING[k]),
    "CURRENT_SETTINGS_REQUIRED",
  );
  check(
    receiver.status().received &&
      !receiver.status().failed &&
      receiver.status().remainingMs >= 1800000,
    "FRESH_RECEIPT_REQUIRED",
  );
  const secretDeadline = Date.now() + receiver.status().remainingMs;
  await receiver.handoff();
  running = true;
  try {
    const baselineRoot = path.join(base, "private-auth-step6");
    const baseline = privateInput(
      path.join(baselineRoot, "runtime.json"),
      baselineRoot,
    );
    check(baseline.NEXT_PUBLIC_SUPABASE_URL === TARGET.supabase);
    secrets = {
      ...privateInput(path.join(root, "stripe-keys.json"), root),
      anon: baseline.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      service: baseline.SUPABASE_SERVICE_ROLE_KEY,
    };
    for (const [name, role] of [
      ["anon", "anon"],
      ["service", "service_role"],
    ]) {
      const p = JSON.parse(
        Buffer.from(secrets[name].split(".")[1], "base64url"),
      );
      check(
        p.ref === TARGET.ref &&
          p.role === role &&
          p.exp * 1000 > Date.now() + 1200000,
        "DB_CREDENTIAL_INVALID",
      );
    }
    for (const role of ["listener", "app", "lifecycle"])
      check(/^rk_test_[A-Za-z0-9]{24,500}$/.test(secrets[role]));
    wire = providerWire({ secrets, record: (v) => record("provider", v) });
    for (const role of ["listener", "app", "lifecycle"]) {
      const a = await wire({
        provider: "stripe",
        role,
        path: "/v1/account",
        operation: "monthly_key_identity",
      });
      check(a.id === TARGET.account, "KEY_ACCOUNT_MISMATCH");
    }
    const binary = "/private/tmp/yorisoi-payment-cli-1.54.0/stripe";
    const cli = {
      binary,
      checksum: createHash("sha256")
        .update(fs.readFileSync(binary))
        .digest("hex"),
    };
    // This exact installed binary must match the separately verified preflight.
    const preflight = privateInput(path.join(root, "preflight.json"), root);
    check(
      preflight.cliSha256 === cli.checksum &&
        preflight.ciPassed === true &&
        preflight.syntheticMonthlyPassed === true &&
        preflight.osIsolationPassed === true,
      "PREFLIGHT_REQUIRED",
    );
    // Exclusive durable claim before the first write; process restarts cannot
    // obtain another G/F allowance from the same historical carry-in.
    claimMonthlyContinuation(claimPath, run);
    outcomes.externalStarted = true;
    const deadline = Math.min(Date.now() + 1200000, secretDeadline - 380000);
    deadlineTimer = setTimeout(
      () => {
        forcedStop = true;
        interrupted.abort();
      },
      Math.max(1, deadline - Date.now()),
    );
    outcomes.execution = await executeMonthly({
      continuation: true,
      signal: interrupted.signal,
      run,
      users,
      secrets,
      wire,
      cli,
      deadline,
      checkpoint: async (value) => {
        check(!closed, "SESSION_CLOSED");
        record("operations", value);
      },
      record,
    });
  } catch {
    outcomes.stopped = true;
    record("session-stop", {
      reason: "preflight_or_execution_failed",
      forcedStop,
    });
  } finally {
    clearTimeout(deadlineTimer);
    // No trial work follows this point. Owner wait is the only allowed extension.
    revocationDeadline = Math.min(Date.now() + 300000, secretDeadline - 20000);
    emit({ phase: "revoke_keys", keyNames: names, until: revocationDeadline });
    let timer;
    const acknowledged = await Promise.race([
      new Promise((r) => {
        ownerResolved = r;
      }),
      new Promise((r) => {
        timer = setTimeout(
          () => r(false),
          Math.max(0, revocationDeadline - Date.now()),
        );
      }),
    ]);
    clearTimeout(timer);
    ownerResolved = undefined;
    outcomes.ownerRevoked = acknowledged === true;
    if (wire) {
      try {
        outcomes.revocation = await verifyRevocation(wire, {
          signal: AbortSignal.timeout(
            Math.max(1, Math.min(15000, secretDeadline - Date.now() - 5000)),
          ),
          record: (v) => {
            outcomes.revocation = v;
            record("revocation", v);
          },
        });
      } catch {
        outcomes.revocationIncomplete = true;
      }
    }
    await erase();
  }
}
const lines = readline.createInterface({
  input: process.stdin,
  terminal: false,
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    forcedStop = true;
    interrupted.abort();
    if (ownerResolved) ownerResolved(false);
    if (!running) void erase();
  });
process.stdin.on("end", () => {
  forcedStop = true;
  interrupted.abort();
  if (ownerResolved) ownerResolved(false);
  if (!running) void erase();
});
emit({ phase: "awaiting_keys", root, run, keyNames: names });
for await (const line of lines) {
  try {
    if (line.trim() === "prepare") emit(await receiver.beforeCreate());
    else if (line.trim() === "status")
      emit({
        phase: running ? "running" : "awaiting_keys",
        ...receiver.status(),
      });
    else if (line.trim() === "run") {
      check(!startRequested, "START_ALREADY_REQUESTED");
      startRequested = true;
      void execute().catch(async () => {
        emit({ phase: "start_denied" });
        if (!running) startRequested = false;
      });
    } else if (line.trim() === "revoked" && ownerResolved) ownerResolved(true);
    else if (line.trim() === "stop") {
      forcedStop = true;
      interrupted.abort();
      if (ownerResolved) ownerResolved(false);
      if (!running) await erase();
    } else emit({ phase: "control_denied" });
  } catch {
    emit({ phase: "control_failed" });
  }
}
