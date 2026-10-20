// Separate paid-purchase continuation. Never calls the purchase launch.run, CLI,
// Stripe provider, Checkout, webhook, seedSql, price mutation or key revocation.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { TARGET, insist, uuid, hash } from "../payment-runtime/policy.mjs";
import { copyApplication, appEnvironment } from "../payment-runtime/launch.mjs";
import {
  startApp,
  stopChild,
  waitReady,
} from "../payment-runtime/processes.mjs";
import { checkedJson, diagnostic } from "../payment-runtime/diagnostics.mjs";
import {
  snapshot,
  validatePaid,
  compareBaseline,
  verifyAfter,
  bodySql,
  reportBody,
} from "./state.mjs";
import {
  ContinuationPolicy,
  supabaseTransport,
  startContinuationBroker,
} from "./network.mjs";
import { executeBody } from "./sql-executor.mjs";
import { verifyAccess } from "./verify.mjs";
import { control } from "./control.mjs";
export function loadInput(file, repo) {
  const s = fs.lstatSync(file),
    root = path.dirname(fs.realpathSync(file));
  insist(
    s.isFile() &&
      !s.isSymbolicLink() &&
      (s.mode & 0o077) === 0 &&
      s.uid === process.getuid() &&
      (fs.statSync(root).mode & 0o077) === 0,
  );
  insist(
    !root.startsWith(fs.realpathSync(repo) + path.sep) &&
      root !== fs.realpathSync(repo),
  );
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  insist(
    c.approved === true &&
      c.project === TARGET.ref &&
      c.account === TARGET.account &&
      c.fixtureDisposition === "reuse",
  );
  insist(
    uuid(c.attemptId) &&
      uuid(c.previousAttemptId) &&
      c.attemptId !== c.previousAttemptId &&
      c.attemptId !== c.manifest.run,
  );
  insist(Object.keys(c.secrets).sort().join(",") === "anon,service");
  for (const [name, role] of [
    ["anon", "anon"],
    ["service", "service_role"],
  ]) {
    const p = JSON.parse(
      Buffer.from(c.secrets[name].split(".")[1], "base64url"),
    );
    insist(p.ref === TARGET.ref && p.role === role);
  }
  for (const k of [
    "NODE_OPTIONS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ])
    insist(!process.env[k]);
  validatePaid(c.manifest, c.baseline, c.expected);
  insist(
    c.database &&
      Object.keys(c.database).sort().join(",") ===
        "binary,binarySha256,ca,caSha256,password",
  );
  return c;
}
export async function run(file, repo, dependencies = {}) {
  const c = loadInput(file, repo),
    root = path.dirname(fs.realpathSync(file)),
    m = c.manifest,
    body = reportBody(repo);
  const runtime = {
    transport: supabaseTransport(c.secrets),
    startBroker: startContinuationBroker,
    startApp,
    stopChild,
    waitReady,
    executeBody,
    input: process.stdin,
    verify: verifyAccess,
    ...dependencies,
  };
  const journal = path.join(root, "continuation-" + c.attemptId + ".jsonl"),
    fd = fs.openSync(journal, "wx", 0o600);
  fs.unlinkSync(file);
  const record = (event, data = {}) => {
    fs.writeSync(
      fd,
      JSON.stringify({ at: new Date().toISOString(), event, ...data }) + "\n",
    );
    fs.fsyncSync(fd);
  };
  let stopped = false,
    reason = "startup_failure",
    resolve,
    app,
    broker,
    ctl,
    work,
    ready = false,
    before,
    bodySent = false,
    bodyDone = false,
    verified = false,
    pending = Promise.resolve(),
    stage = "startup";
  const done = new Promise((r) => {
      resolve = r;
    }),
    stop = (why) => {
      if (!stopped) {
        stopped = true;
        reason = why;
        resolve();
      }
    };
  const policy = new ContinuationPolicy(m, c.expected, (tag, n) =>
    record("send_reserved", { operation: tag.split(":")[0], count: n }),
  );
  const transport = (r) => {
    insist(!stopped, "RUNTIME_STOPPING");
    return runtime.transport(r);
  };
  const read = (p, operation) =>
    checkedJson(
      transport,
      {
        url: TARGET.supabase + "/rest/v1/" + p,
        method: "GET",
        headers: {
          apikey: "local-service",
          authorization: "Bearer local-service",
        },
        body: "",
      },
      { stage, operation, record },
    );
  const key = crypto.randomBytes(32);
  fs.writeFileSync(path.join(root, "backup-" + c.attemptId + ".key"), key, {
    flag: "wx",
    mode: 0o600,
  });
  const backup = (name, value) => {
    const plain = Buffer.from(JSON.stringify(value)),
      iv = crypto.randomBytes(12),
      enc = crypto.createCipheriv("aes-256-gcm", key, iv),
      cipher = Buffer.concat([enc.update(plain), enc.final()]),
      sealed = Buffer.concat([iv, enc.getAuthTag(), cipher]),
      p = path.join(root, name + "-" + c.attemptId + ".aesgcm");
    fs.writeFileSync(p, sealed, { flag: "wx", mode: 0o600 });
    const saved = fs.readFileSync(p),
      dec = crypto.createDecipheriv("aes-256-gcm", key, saved.subarray(0, 12));
    dec.setAuthTag(saved.subarray(12, 28));
    insist(
      Buffer.concat([dec.update(saved.subarray(28)), dec.final()]).equals(
        plain,
      ),
    );
    record("encrypted_backup", {
      name,
      sha256: hash(saved),
      decryptionExact: true,
    });
  };
  const action = (command) => {
    pending = (async () => {
      insist(!stopped && ready);
      if (command === "body") {
        insist(
          !bodySent && !bodyDone && policy.sessionsData.size === 0,
          "BODY_STAGE",
        );
        stage = "body";
        const current = await snapshot(read);
        compareBaseline(current, before);
        insist(!stopped);
        const sql = bodySql(m, current, c.expected, body);
        bodySent = true;
        record("body_attempt_reserved", { sha256: hash(sql) });
        const result = await runtime.executeBody(sql, c.database, root, record);
        insist(result.exitCode === 0 && result.commitResponse);
        bodyDone = true;
        const after = await snapshot(read);
        validatePaid(m, after, c.expected, body);
        verifyAfter(before, after, body);
        backup("after-body", after);
        policy.ready = true;
        record("body_verified");
      } else {
        insist(
          bodyDone && !verified && policy.sessionsData.size === 2,
          "VERIFY_STAGE",
        );
        stage = "verify";
        await runtime.verify(
          m,
          c.expected,
          body,
          policy.sessionsData,
          transport,
          record,
        );
        const after = await snapshot(read);
        validatePaid(m, after, c.expected, body);
        verifyAfter(before, after, body);
        backup("after-verification", after);
        verified = true;
        record("verification_complete");
      }
    })().catch((e) => {
      record("failure", { stage, ...diagnostic(e) });
      throw e;
    });
    return pending;
  };
  const signal = () => stop("interrupted"),
    hangup = () => stop("input_hangup");
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  process.once("SIGHUP", hangup);
  const timer = setTimeout(() => stop("run_timeout"), 20 * 60 * 1000);
  let closure;
  try {
    record("start", {
      attemptId: c.attemptId,
      previousAttemptId: c.previousAttemptId,
      fixtureRun: m.run,
      mode: "paid_continuation",
    });
    ctl = control({
      input: runtime.input,
      stop,
      record,
      write: (t) => process.stdout.write(t),
      status: () => ({
        ready,
        stopping: stopped,
        applicationAlive:
          !!app && app.exitCode === null && app.signalCode === null,
        brokerListening: broker?.server.listening === true,
        bodyDone,
        verified,
      }),
      action,
    });
    stage = "preflight";
    before = await snapshot(read);
    validatePaid(m, before, c.expected);
    compareBaseline(before, c.baseline);
    backup("before", before);
    const token = crypto.randomBytes(32).toString("base64url");
    broker = await runtime.startBroker({
      policy,
      transport,
      token,
      record,
      onStop: stop,
    });
    insist(!stopped);
    work = fs.mkdtempSync(path.join(os.tmpdir(), "yorisoi-continuation-"));
    fs.chmodSync(work, 0o700);
    const dest = path.join(work, "app");
    copyApplication(repo, dest);
    fs.cpSync(
      path.join(repo, "scripts/phase6/payment-continuation"),
      path.join(dest, "scripts/phase6/payment-continuation"),
      { recursive: true },
    );
    fs.copyFileSync(
      path.join(repo, "scripts/phase6/payment-continuation/server.mjs"),
      path.join(dest, "scripts/phase6/payment-runtime/server.mjs"),
    );
    const env = appEnvironment(m, {
      token,
      forward: "continuation-disabled",
      webhook: "whsec_unused_continuation",
    });
    app = runtime.startApp({ cwd: dest, env, privateDir: root });
    app.once("exit", () => stop("app_exit"));
    await runtime.waitReady(app);
    insist(!stopped);
    ready = true;
    record("ready");
    process.stdout.write(
      "Continuation ready; commands: status, body, verify, finish. No login before body_verified.\n",
    );
    await done;
  } catch (e) {
    record("failure", { stage, ...diagnostic(e) });
    stop("execution_failed");
  } finally {
    clearTimeout(timer);
    stopped = true;
    ready = false;
    policy.stopped = true;
    ctl?.close();
    await pending.catch(() => {});
    const results = await Promise.allSettled([
      runtime.stopChild(app),
      broker?.stop(),
    ]);
    let removed = false;
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      if (work) fs.rmSync(work, { recursive: true, force: true });
      const pass = path.join(root, "continuation.pgpass");
      if (fs.existsSync(pass)) fs.unlinkSync(pass);
      removed = !fs.existsSync(file) && (!work || !fs.existsSync(work));
    } catch {
      removed = false;
    }
    policy.clear();
    c.database.password = "";
    c.secrets.anon = "";
    c.secrets.service = "";
    key.fill(0);
    closure = {
      reason,
      bodySent,
      bodyDone,
      verified,
      processesStopped: results.every((x) => x.status === "fulfilled"),
      temporaryRemoved: removed,
      priceMutation: false,
      stripeCalls: 0,
    };
    closure.cleanupComplete = closure.processesStopped && removed;
    closure.complete =
      verified && closure.cleanupComplete && reason === "operator_finished";
    record("closure", closure);
    fs.closeSync(fd);
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
    process.off("SIGHUP", hangup);
    process.stdout.write(JSON.stringify(closure) + "\n");
  }
  return closure.complete ? 0 : 2;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 4 || process.argv[2] !== "--approved-input") {
    console.error("PRIVATE_CONTINUATION_INPUT_REQUIRED");
    process.exitCode = 1;
  } else {
    const file = path.resolve(process.argv[3]);
    try {
      process.exitCode = await run(file, process.cwd());
    } catch {
      console.error("CONTINUATION_FAILED_NO_RETRY");
      process.exitCode = 1;
    } finally {
      if (fs.existsSync(file)) {
        const s = fs.lstatSync(file);
        if (
          s.isFile() &&
          !s.isSymbolicLink() &&
          (s.mode & 0o077) === 0 &&
          s.uid === process.getuid()
        )
          fs.unlinkSync(file);
      }
    }
  }
}
