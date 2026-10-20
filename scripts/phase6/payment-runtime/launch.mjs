// Explicit execution entry point; importing it never starts processes or uses credentials.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  TARGET,
  Policy,
  insist,
  hash,
  validateManifest,
  uuid,
} from "./policy.mjs";
import { startBroker, providerTransport } from "./broker.mjs";
import { deactivatePrice, finish } from "./cleanup.mjs";
import { startApp, stopChild, waitReady, startListener } from "./processes.mjs";
import { createObserver } from "./observer.mjs";
import { databasePreflight, startupQueries } from "./preflight.mjs";
import { checkedJson, diagnostic } from "./diagnostics.mjs";
import { bindControl } from "./control.mjs";
export function loadInput(file) {
  insist(
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
    "UNAPPROVED_RUNTIME_OVERRIDE",
  );
  const s = fs.lstatSync(file);
  insist(
    s.isFile() &&
      !s.isSymbolicLink() &&
      (s.mode & 0o077) === 0 &&
      s.uid === process.getuid(),
  );
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  validateManifest(c.manifest);
  startupQueries(c.manifest);
  insist(
    c.fixtureDisposition === "reuse" &&
      uuid(c.attemptId) &&
      uuid(c.previousAttemptId) &&
      c.attemptId !== c.previousAttemptId &&
      c.attemptId !== c.manifest.run,
    "NEW_ATTEMPT_REQUIRED",
  );
  insist(
    c.approved === true &&
      c.purchasePreflightVerified === true &&
      c.cliPermissionsVerified === true,
    "APPROVAL_GATE",
  );
  insist(c.project === TARGET.ref && c.account === TARGET.account);
  insist(
    /^rk_test_/.test(c.secrets.stripe) &&
      /^rk_test_/.test(c.secrets.listener) &&
      c.secrets.stripe !== c.secrets.listener,
  );
  for (const [name, role] of [
    ["anon", "anon"],
    ["service", "service_role"],
  ]) {
    const p = JSON.parse(
      Buffer.from(c.secrets[name].split(".")[1], "base64url"),
    );
    insist(p.ref === TARGET.ref && p.role === role, "KEY_TARGET_MISMATCH");
  }
  insist(
    path.isAbsolute(c.cli) &&
      fs.statSync(c.cli).isFile() &&
      hash(fs.readFileSync(c.cli)) === c.cliSha256,
    "CLI_NOT_VERIFIED",
  );
  return c;
}
export function appEnvironment(m, { token, forward, webhook }) {
  return {
    PATH: path.dirname(process.execPath) + ":/usr/bin:/bin",
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    PAYMENT_INTEGRATION_LOCAL: "true",
    PAYMENT_INTEGRATION_DIAGNOSIS_ID: m.diagnosis,
    PAYMENT_INTEGRATION_BUYER_ID: m.a.id,
    NEXT_PUBLIC_APP_URL: TARGET.app,
    NEXT_PUBLIC_SUPABASE_URL: TARGET.supabase,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon",
    SUPABASE_SERVICE_ROLE_KEY: "local-service",
    SESSION_SECRET: m.sessionSecret,
    STRIPE_SECRET_KEY: "rk_test_local_proxy",
    STRIPE_WEBHOOK_SECRET: webhook,
    STRIPE_ACCOUNT_ID: TARGET.account,
    STRIPE_MODE: "sandbox",
    TRIAL_ENABLED: "false",
    TRIAL_RETENTION_VERIFIED: "false",
    TRIAL_BUDGET_VERIFIED: "false",
    PREVIEW_DEMO_ENABLED: "false",
    PUBLIC_INDEXING_ENABLED: "false",
    STRIPE_LIVE_CHECKOUT_ENABLED: "false",
    PAYMENT_PROXY_TOKEN: token,
    PAYMENT_FORWARD_TOKEN: forward,
    PAYMENT_COOKIE_A: m.a.cookie,
    PAYMENT_COOKIE_B: m.b.cookie,
  };
}
export function copyApplication(repo, destination) {
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const name of [
    "src",
    "public",
    "scripts/phase6/payment-runtime",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
  ]) {
    const from = path.join(repo, name);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(destination, name)), {
      recursive: true,
    });
    fs.cpSync(from, path.join(destination, name), {
      recursive: true,
      filter: (p) => !path.basename(p).startsWith(".env"),
    });
  }
  fs.symlinkSync(
    path.join(repo, "node_modules"),
    path.join(destination, "node_modules"),
    "dir",
  );
  insist(!fs.readdirSync(destination).some((x) => x.startsWith(".env")));
}
export function stoppableTransport(transport, isStopped) {
  return (request) => {
    insist(!isStopped(), "RUNTIME_STOPPING");
    return transport(request);
  };
}
// Dependency injection is programmatic only for credential-free isolated tests.
// CLI/approved-input cannot select transports, processes or override destinations.
export async function run(file, repo, dependencies = {}) {
  const runtime = {
    providerTransport,
    startBroker,
    startListener,
    startApp,
    waitReady,
    copyApplication,
    stdin: process.stdin,
    ...dependencies,
  };
  let c;
  try {
    c = loadInput(file);
  } catch {
    // Only the explicitly supplied, owner-only temporary regular file may be removed.
    const s = fs.lstatSync(file);
    if (
      s.isFile() &&
      !s.isSymbolicLink() &&
      (s.mode & 0o077) === 0 &&
      s.uid === process.getuid()
    )
      fs.unlinkSync(file);
    throw new Error("PREPARATION_FAILED_CLEANUP_UNCONFIRMED");
  }
  const m = c.manifest;
  const root = path.dirname(fs.realpathSync(file));
  insist((fs.statSync(root).mode & 0o077) === 0, "PRIVATE_DIRECTORY_REQUIRED");
  const repository = fs.realpathSync(repo);
  insist(
    root !== repository && !root.startsWith(repository + path.sep),
    "CREDENTIALS_MUST_BE_OUTSIDE_REPOSITORY",
  );
  const journal = path.join(root, "payment-" + c.attemptId + ".jsonl");
  fs.unlinkSync(file); // Dedicated temporary input consumed, even if a duplicate run is refused.
  const fd = fs.openSync(journal, "wx", 0o600); // Never reuse an old send reservation.
  let lastHttpStatus = null;
  const record = (event, extra = {}) => {
    if (event === "operation_response" || event === "operation_failed")
      lastHttpStatus = extra.httpStatus;
    fs.writeSync(
      fd,
      JSON.stringify({ at: new Date().toISOString(), event, ...extra }) + "\n",
    );
    fs.fsyncSync(fd);
  };
  const token = randomBytes(32).toString("base64url"),
    forward = randomBytes(32).toString("base64url");
  let app,
    listener,
    broker,
    control,
    observer,
    work,
    shutdownRequested = false,
    reason = "startup_failure",
    exitResolve;
  const wait = new Promise((resolve) => {
    exitResolve = resolve;
  });
  const stop = (why) => {
    if (!shutdownRequested) {
      shutdownRequested = true;
      reason = why;
      exitResolve();
    }
  };
  const policy = new Policy(m, (tag, n) =>
    record("send_reserved", { operation: tag.split(":")[0], sequence: n }),
  );
  let stage = "preflight",
    operation = "database";
  const checkpoint = (s, o) => {
    stage = s;
    operation = o;
    lastHttpStatus = null;
    record("operation_start", { stage, operation });
  };
  const externalTransport = runtime.providerTransport(c.secrets);
  const transport = stoppableTransport(
    externalTransport,
    () => shutdownRequested,
  );
  const dbRead = (method, p, body, maintenance = false, name) => {
    const op =
      name ??
      (p.startsWith("payment_environment?")
        ? "environment"
        : method === "PATCH"
          ? "price_deactivate"
          : "prices");
    return checkedJson(
      maintenance ? externalTransport : transport,
      {
        url: TARGET.supabase + "/rest/v1/" + p,
        method,
        headers: {
          apikey: "local-service",
          authorization: "Bearer local-service",
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: body ? JSON.stringify(body) : "",
      },
      { stage: maintenance ? "cleanup" : "preflight", operation: op, record },
    );
  };
  const signal = () => stop("interrupted");
  const hangup = () => stop("input_hangup");
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  process.once("SIGHUP", hangup);
  const timer = setTimeout(() => stop("run_timeout"), 20 * 60 * 1000);
  // Every startup failure after consuming the credential file reaches the same finally path.
  try {
    record("start", {
      run: c.attemptId,
      fixtureRun: m.run,
      previousAttempt: c.previousAttemptId,
      diagnosis: m.diagnosis,
      buyer: m.a.id,
      otherUser: m.b.id,
      project: TARGET.ref,
      account: TARGET.account,
      keyFingerprints: [hash(c.secrets.stripe), hash(c.secrets.listener)],
    });
    checkpoint("startup", "control_attach");
    control = bindControl({
      input: runtime.stdin,
      stop,
      record,
      status: () => ({
        ready: policy.ready && !shutdownRequested,
        stopping: shutdownRequested,
        applicationAlive:
          !!app && app.exitCode === null && app.signalCode === null,
        listenerAlive:
          !!listener &&
          listener.child.exitCode === null &&
          listener.child.signalCode === null,
        brokerListening: broker?.server.listening === true,
      }),
      action: (command) =>
        command === "duplicate"
          ? observer.duplicate()
          : observer.rls(policy.payment),
      write: (text) => process.stdout.write(text),
    });
    await databasePreflight(m, dbRead, (op) => checkpoint("preflight", op));
    for (const [name, accountTransport] of [
      ["app_account", transport],
      [
        "listener_account",
        stoppableTransport(
          runtime.providerTransport({
            ...c.secrets,
            stripe: c.secrets.listener,
          }),
          () => shutdownRequested,
        ),
      ],
    ]) {
      checkpoint("preflight", name);
      const account = await checkedJson(
        accountTransport,
        {
          url: TARGET.stripe + "/v1/account",
          method: "GET",
          headers: {},
          body: "",
        },
        { stage, operation, record },
      );
      insist(
        account && !Array.isArray(account) && account.id === TARGET.account,
        "LISTENER_ACCOUNT_UNVERIFIED",
      );
    }
    // No Checkout is allowed until the operator has verified test capability, CLI permissions,
    // exact fixture/anonymous-state counts, DB trial OFF and receipt settings in the approval checklist.
    let webhook;
    observer = createObserver({
      manifest: m,
      record,
      secret: () => webhook,
      request: async (jwt, p) => {
        const r = await transport({
          url: TARGET.supabase + "/rest/v1/" + p,
          method: "GET",
          headers: { apikey: "local-anon", authorization: "Bearer " + jwt },
          body: "",
        });
        insist(r.status === 200, "RLS_READ_FAILED");
        return JSON.parse(r.text);
      },
      replay: async (raw, signature) => {
        const r = await fetch("http://127.0.0.1:5209/webhook", {
          method: "POST",
          headers: {
            "stripe-signature": signature,
            "content-type": "application/json",
          },
          body: raw,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        insist(r.ok, "DUPLICATE_FAILED_OR_UNKNOWN");
        await r.text();
      },
    });
    checkpoint("startup", "broker_start");
    broker = await runtime.startBroker({
      policy,
      transport,
      token,
      forwardToken: forward,
      webhookSecret: () => webhook,
      onStop: stop,
      onAccepted: (ticket, data) => observer.accepted(ticket, data),
      onWebhookSuccess: (raw, signature) => observer.webhook(raw, signature),
      forward: async (raw, signature, forwardToken) => {
        const r = await fetch("http://127.0.0.1:5208/api/webhooks/stripe", {
          method: "POST",
          headers: {
            "stripe-signature": signature,
            "x-payment-forward": forwardToken,
            "content-type": "application/json",
          },
          body: raw,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        return { status: r.status, text: await r.text() };
      },
    });
    insist(!shutdownRequested, "RUNTIME_STOPPING");
    checkpoint("startup", "listener_start");
    listener = runtime.startListener({
      binary: c.cli,
      run: c.attemptId,
      key: c.secrets.listener,
      onUnexpectedExit: () => stop("listener_exit"),
    });
    webhook = await listener.ready;
    insist(!shutdownRequested, "RUNTIME_STOPPING");
    work = fs.mkdtempSync(path.join(os.tmpdir(), "yorisoi-payment-"));
    fs.chmodSync(work, 0o700);
    const appDir = path.join(work, "app");
    checkpoint("startup", "application_copy");
    runtime.copyApplication(repo, appDir);
    checkpoint("startup", "application_start");
    app = runtime.startApp({
      cwd: appDir,
      env: appEnvironment(m, { token, forward, webhook }),
      privateDir: root,
    });
    app.once("exit", () => stop("app_exit"));
    checkpoint("startup", "application_ready");
    await runtime.waitReady(app);
    insist(!shutdownRequested);
    policy.ready = true;
    record("ready");
    process.stdout.write(
      "Dedicated app ready: http://localhost:5208/payment-test/start/a (B uses /b). Commands: status, duplicate, rls, finish. Keep this interactive session open.\n",
    );
    await wait;
  } catch (error) {
    stop("execution_failed");
    record("execution_failed", {
      stage,
      operation,
      ...diagnostic(error),
      httpStatus: diagnostic(error).httpStatus ?? lastHttpStatus,
    });
  } finally {
    clearTimeout(timer);
    policy.stopped = true;
    control?.close();
    observer?.clear();
    const result = await finish({
      reason,
      keys: [c.secrets.stripe, c.secrets.listener],
      stopProcesses: async () => {
        const results = await Promise.allSettled([
          stopChild(app),
          stopChild(listener?.child),
          broker?.stop(),
        ]);
        insist(results.every((r) => r.status === "fulfilled"));
      },
      deactivate: async () => {
        try {
          return await deactivatePrice((method, p, body) =>
            dbRead(method, p, body, true),
          );
        } catch (error) {
          record("cleanup_failed", {
            stage: "cleanup",
            operation: "price_verification",
            ...diagnostic(error),
            httpStatus: diagnostic(error).httpStatus ?? lastHttpStatus,
          });
          throw error;
        }
      },
      eraseTemporary: async () => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        if (work) fs.rmSync(work, { recursive: true, force: true });
        insist(!fs.existsSync(file) && (!work || !fs.existsSync(work)));
      },
    });
    record("runtime_inventory", {
      payment: policy.payment ?? null,
      checkout: policy.checkout ?? null,
      intent: policy.intent ?? null,
      eventCount: policy.events.size,
      openOperationLock: !!policy.lock,
    });
    record("closure", result);
    fs.closeSync(fd);
    process.removeListener("SIGINT", signal);
    process.removeListener("SIGTERM", signal);
    process.removeListener("SIGHUP", hangup);
    process.stdout.write(JSON.stringify(result) + "\n");
    return result.complete ? 0 : 2;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 4 || process.argv[2] !== "--approved-input") {
    console.error(
      "Requires a private approved input file; no default environment is loaded.",
    );
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = await run(
        path.resolve(process.argv[3]),
        process.cwd(),
      );
    } catch {
      console.error(
        "PAYMENT_RUNTIME_PREPARATION_FAILED: price/key cleanup unconfirmed; temporary input must be checked. No retry.",
      );
      process.exitCode = 1;
    } finally {
      const input = path.resolve(process.argv[3]);
      if (fs.existsSync(input)) {
        const stat = fs.lstatSync(input);
        if (
          stat.isFile() &&
          !stat.isSymbolicLink() &&
          (stat.mode & 0o077) === 0 &&
          stat.uid === process.getuid()
        )
          fs.unlinkSync(input);
        else {
          console.error(
            "TEMPORARY_INPUT_NOT_REMOVED: manual verification required",
          );
          process.exitCode = 1;
        }
      }
    }
  }
}
