import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { listenerArgs, startListener, stopChild } from "./processes.mjs";
import { finish } from "./cleanup.mjs";
import { verifyClosure } from "./verify-closure.mjs";
import { hash, TARGET } from "./policy.mjs";
import { m } from "./offline-fixture.mjs";
test("pinned CLI subscribes only to self completed events without update checks", () => {
  assert.deepEqual(listenerArgs(m.run), [
    "listen",
    "--project-name",
    "yorisoi-payment-" + m.run,
    "--events",
    "checkout.session.completed",
    "--events-from",
    "@self",
    "--skip-update",
    "--forward-to",
    "http://127.0.0.1:5209/webhook",
  ]);
});
for (const reason of ["operator_finished", "midrun_failure", "interrupted"])
  test(
    "real owned process and temporary credential teardown: " + reason,
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-lifecycle-"));
      const input = path.join(dir, "temp-input");
      fs.writeFileSync(input, "SYNTHETIC_ONLY", { mode: 0o600 });
      const process = spawn("/bin/sleep", ["30"], {
        detached: true,
        stdio: "ignore",
      });
      try {
        const result = await finish({
          reason,
          keys: ["rk_test_synthetic"],
          stopProcesses: () => stopChild(process),
          deactivate: async () => {
            if (reason === "midrun_failure") throw Error("UPSTREAM_UNKNOWN");
          },
          eraseTemporary: async () => fs.unlinkSync(input),
        });
        assert(!fs.existsSync(input));
        assert(process.exitCode !== null || process.signalCode !== null);
        assert.equal(result.complete, false);
        assert.equal(
          result.price,
          reason === "midrun_failure"
            ? "failed_or_unknown"
            : "verified_inactive",
        );
      } finally {
        await stopChild(process);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
test("fake CLI is supervised, only signing secret parsed, then process group stopped", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-cli-"));
  const executable = path.join(dir, "fake-cli");
  fs.writeFileSync(
    executable,
    '#!/bin/sh\nprintf "Ready whsec_syntheticOnly\\n"\nexec /bin/sleep 30\n',
    { mode: 0o700 },
  );
  const { child, ready } = startListener({
    binary: executable,
    run: m.run,
    key: "rk_test_synthetic",
    onUnexpectedExit: () => {},
  });
  try {
    assert.equal(await ready, "whsec_syntheticOnly");
    await stopChild(child);
    assert(child.exitCode !== null || child.signalCode !== null);
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("CLI startup error produces failure, not ready or silent fallback", async () => {
  const { child, ready } = startListener({
    binary: "/does-not-exist",
    run: m.run,
    key: "rk_test_synthetic",
    onUnexpectedExit: () => {},
  });
  await assert.rejects(ready);
  await stopChild(child);
});
for (const success of [true, false])
  test(
    "closure observation appends without overwriting, removes temporary keys: " +
      success,
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-close-"));
      const keys = ["rk_test_syntheticA", "rk_test_syntheticB"];
      const journal = path.join(dir, "audit.jsonl");
      const old =
        JSON.stringify({
          event: "closure",
          processes: "stopped",
          price: "verified_inactive",
          temporary: "deleted",
          keys: keys.map((k) => ({ fingerprint: hash(k) })),
        }) + "\n";
      fs.writeFileSync(journal, old, { mode: 0o600 });
      const file = path.join(dir, "input");
      fs.writeFileSync(
        file,
        JSON.stringify({
          approved: true,
          project: TARGET.ref,
          account: TARGET.account,
          keys,
          journal,
        }),
        { mode: 0o600 },
      );
      try {
        const result = await verifyClosure(file, async () => ({
          status: success ? 401 : 403,
          code: "api_key_expired",
        }));
        assert.equal(result.complete, success);
        assert(!fs.existsSync(file));
        assert(fs.readFileSync(journal, "utf8").startsWith(old));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
test("key check network failure stops without retry and removes temporary keys", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-close-"));
  const keys = ["rk_test_syntheticA", "rk_test_syntheticB"];
  const journal = path.join(dir, "audit.jsonl");
  fs.writeFileSync(
    journal,
    JSON.stringify({
      event: "closure",
      keys: keys.map((k) => ({ fingerprint: hash(k) })),
    }) + "\n",
    { mode: 0o600 },
  );
  const file = path.join(dir, "input");
  fs.writeFileSync(
    file,
    JSON.stringify({
      approved: true,
      project: TARGET.ref,
      account: TARGET.account,
      keys,
      journal,
    }),
    { mode: 0o600 },
  );
  let calls = 0;
  try {
    await assert.rejects(
      verifyClosure(file, async () => {
        calls++;
        throw Error("TIMEOUT");
      }),
    );
    assert.equal(calls, 1);
    assert(!fs.existsSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("listener wrapper stops its CLI when supervisor IPC disappears", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-orphan-"));
  const pidFile = path.join(dir, "pid");
  const executable = path.join(dir, "fake-cli");
  fs.writeFileSync(
    executable,
    `#!/bin/sh\necho $$ > '${pidFile}'\nprintf 'Ready whsec_syntheticOnly\\n'\nexec /bin/sleep 30\n`,
    { mode: 0o700 },
  );
  const { child, ready } = startListener({
    binary: executable,
    run: m.run,
    key: "rk_test_synthetic",
    onUnexpectedExit: () => {},
  });
  try {
    await ready;
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    child.disconnect();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("ORPHAN_ALIVE")), 4000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    assert.throws(() => process.kill(pid, 0));
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unapproved entrypoint removes its temporary input without logging credentials", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-input-"));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, "input");
  fs.writeFileSync(
    file,
    JSON.stringify({ approved: false, privateValue: "NEVER_LOG_THIS" }),
    { mode: 0o600 },
  );
  const child = spawn(
    process.execPath,
    ["scripts/phase6/payment-runtime/launch.mjs", "--approved-input", file],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (output += x));
  try {
    const code = await new Promise((r) => child.once("exit", r));
    assert.notEqual(code, 0);
    assert(!fs.existsSync(file));
    assert(!output.includes("NEVER_LOG_THIS"));
    assert(output.includes("cleanup unconfirmed"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("old run reservation is immutable and cannot start another attempt", async () => {
  const { run } = await import("./launch.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-duplicate-"));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, "input");
  const attemptId = "20000000-0000-4000-8000-000000000001";
  const journal = path.join(dir, "payment-" + attemptId + ".jsonl");
  const old = "previous attempt retained\n";
  fs.writeFileSync(journal, old, { mode: 0o600 });
  const key = (role) =>
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
      purchasePreflightVerified: true,
      cliPermissionsVerified: true,
      project: TARGET.ref,
      account: TARGET.account,
      manifest: m,
      attemptId,
      previousAttemptId: m.run,
      fixtureDisposition: "reuse",
      cli: "/usr/bin/true",
      cliSha256: hash(fs.readFileSync("/usr/bin/true")),
      secrets: {
        anon: key("anon"),
        service: key("service_role"),
        stripe: "rk_test_syntheticA",
        listener: "rk_test_syntheticB",
      },
    }),
    { mode: 0o600 },
  );
  try {
    await assert.rejects(run(file, process.cwd()), { code: "EEXIST" });
    assert(!fs.existsSync(file));
    assert.equal(fs.readFileSync(journal, "utf8"), old);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("interruption closes ordinary transport before any later provider request", async () => {
  const { stoppableTransport } = await import("./launch.mjs");
  let stopped = false,
    calls = 0;
  const transport = stoppableTransport(
    async () => {
      calls++;
      return "synthetic";
    },
    () => stopped,
  );
  assert.equal(await transport({}), "synthetic");
  stopped = true;
  assert.throws(() => transport({}), /RUNTIME_STOPPING/);
  assert.equal(calls, 1);
});
