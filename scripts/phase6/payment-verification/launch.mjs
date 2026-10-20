// Ready-report verification only. No psql, body update, purchase or Stripe capability.
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
  reportBody,
} from "../payment-continuation/state.mjs";
import {
  VerificationPolicy,
  supabaseTransport,
  startBroker,
  ratesUnchangedExcept,
} from "./network.mjs";
import { startBrowser } from "./browser.mjs";
import { verifyAccess } from "../payment-continuation/verify.mjs";
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
  validatePaid(c.manifest, c.baseline, c.expected, reportBody(repo));
  insist(
    !("database" in c) && Array.isArray(c.rateBaseline),
    "NO_DATABASE_INPUT",
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
    startBroker,
    startBrowser,
    startApp,
    stopChild,
    waitReady,
    input: process.stdin,
    verify: verifyAccess,
    ...dependencies,
  };
  const journal = path.join(root, "verification-" + c.attemptId + ".jsonl"),
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
    browser,
    ctl,
    work,
    ready = false,
    before,
    beforeRates,
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
  const policy = new VerificationPolicy(m, c.expected, (tag, n) =>
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
      stage = command;
      if (command === "open-a" || command === "open-b") {
        await browser.open(command.endsWith("a") ? "A" : "B");
      } else if (command === "check-a" || command === "check-b") {
        await browser.check(command.endsWith("a") ? "A" : "B");
      } else if (command === "anonymous") {
        await browser.anonymous();
      } else {
        insist(
          !verified && browser.allChecked() && policy.sessionsData.size === 2,
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
        compareBaseline(after, before);
        const rates = await read("rate_limits?select=*", "rate_limits");
        record(
          "rate_comparison",
          ratesUnchangedExcept(beforeRates, rates, policy),
        );
        backup("after-verification", { state: after, rate_limits: rates });
        verified = true;
        record("verification_complete");
      }
    })().catch((e) => {
      record("failure", {
        stage,
        ...diagnostic(e),
      });
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
      mode: "ready_report_verification",
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
        browserAlive: browser?.alive() === true,
        verified,
      }),
      action,
    });
    stage = "preflight";
    before = await snapshot(read);
    validatePaid(m, before, c.expected, body);
    compareBaseline(before, c.baseline);
    beforeRates = await read("rate_limits?select=*", "rate_limits");
    insist(
      JSON.stringify(beforeRates) === JSON.stringify(c.rateBaseline),
      "RATE_BASELINE_CHANGED",
    );
    backup("before", { state: before, rate_limits: beforeRates });
    policy.ready = true;
    const token = crypto.randomBytes(32).toString("base64url");
    broker = await runtime.startBroker({
      policy,
      transport,
      token,
      record,
      onStop: stop,
    });
    insist(!stopped);
    work = fs.mkdtempSync(path.join(os.tmpdir(), "yorisoi-verification-"));
    fs.chmodSync(work, 0o700);
    const dest = path.join(work, "app");
    copyApplication(repo, dest);
    fs.cpSync(
      path.join(repo, "scripts/phase6/payment-continuation"),
      path.join(dest, "scripts/phase6/payment-continuation"),
      { recursive: true },
    );
    fs.cpSync(
      path.join(repo, "scripts/phase6/payment-verification"),
      path.join(dest, "scripts/phase6/payment-verification"),
      { recursive: true },
    );
    fs.copyFileSync(
      path.join(repo, "scripts/phase6/payment-verification/server.mjs"),
      path.join(dest, "scripts/phase6/payment-runtime/server.mjs"),
    );
    const env = appEnvironment(m, {
      token,
      forward: "continuation-disabled",
      webhook: "whsec_unused_continuation",
    });
    env.PAYMENT_VERIFY_ONLY = "true";
    app = runtime.startApp({ cwd: dest, env, privateDir: root });
    app.once("exit", () => stop("app_exit"));
    app.on("message", (m) => {
      if (m?.unsafeRequest) stop("unapproved_app_request");
      if (m?.http) record("application_http", m.http);
    });
    await runtime.waitReady(app);
    insist(!stopped);
    browser = await runtime.startBrowser({
      dir: work,
      manifest: m,
      body,
      record,
      onStop: stop,
      headless: dependencies.headless === true,
    });
    ready = true;
    record("ready");
    process.stdout.write(
      "Verification ready; commands: status, open-a, check-a, open-b, check-b, anonymous, verify, finish.\n",
    );
    await done;
  } catch (e) {
    record("failure", {
      stage,
      ...diagnostic(e),
    });
    stop("execution_failed");
  } finally {
    clearTimeout(timer);
    stopped = true;
    ready = false;
    policy.stopped = true;
    ctl?.close();
    await pending.catch(() => {});
    const results = await Promise.allSettled([
      browser?.stop(),
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
    c.secrets.anon = "";
    c.secrets.service = "";
    key.fill(0);
    closure = {
      reason,
      bodyWrites: 0,
      psqlConnections: 0,
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
    console.error("PRIVATE_VERIFICATION_INPUT_REQUIRED");
    process.exitCode = 1;
  } else {
    const file = path.resolve(process.argv[3]);
    try {
      process.exitCode = await run(file, process.cwd());
    } catch {
      console.error("VERIFICATION_FAILED_NO_RETRY");
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
