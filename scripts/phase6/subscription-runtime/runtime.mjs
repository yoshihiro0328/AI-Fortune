import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { TARGET, Policy, check } from "./policy.mjs";
import { PostClosePolicy } from "./post-close-policy.mjs";
import { startBroker } from "../payment-runtime/broker.mjs";
import { copyApplication } from "../payment-runtime/launch.mjs";
import {
  sandboxProfile,
  waitReady,
  stopChild,
} from "../payment-runtime/processes.mjs";
export function environment(m, token, forward, secret) {
  return {
    PATH: path.dirname(process.execPath) + ":/usr/bin:/bin",
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    SUBSCRIPTION_INTEGRATION_LOCAL: "true",
    SUBSCRIPTION_BUYER_ID: m.c.id,
    SUBSCRIPTION_CUSTOMER_ID: m.customer,
    SUBSCRIPTION_PROXY_TOKEN: token,
    SUBSCRIPTION_FORWARD_TOKEN: forward,
    SUBSCRIPTION_SYNTHETIC: String(m.synthetic),
    NEXT_PUBLIC_APP_URL: TARGET.app,
    NEXT_PUBLIC_SUPABASE_URL: TARGET.supabase,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon",
    SUPABASE_SERVICE_ROLE_KEY: "local-service",
    SESSION_SECRET: m.sessionSecret,
    SUBSCRIPTION_COOKIE_C: m.c.cookie,
    SUBSCRIPTION_COOKIE_D: m.d.cookie,
    SUBSCRIPTION_BROWSER_COOKIE_NAMESPACE: `plus-${randomBytes(16).toString("hex")}--`,
    STRIPE_SECRET_KEY: "rk_test_local_proxy",
    STRIPE_WEBHOOK_SECRET: secret,
    STRIPE_ACCOUNT_ID: TARGET.account,
    STRIPE_MODE: "sandbox",
    AUTH_EMAIL_MODE: "custom",
    TRIAL_ENABLED: "false",
    TRIAL_RETENTION_VERIFIED: "false",
    TRIAL_BUDGET_VERIFIED: "false",
    PREVIEW_DEMO_ENABLED: "false",
    PUBLIC_INDEXING_ENABLED: "false",
    STRIPE_LIVE_CHECKOUT_ENABLED: "false",
  };
}
export async function startRuntime({
  m,
  transport,
  repo = process.cwd(),
  record = () => {},
  onStop = () => {},
  webhookSecret,
  reserve,
  evidence,
  authOnly = false,
  browserState,
}) {
  check(
    (authOnly &&
      m.scenario === "minimal-plus-v1" &&
      m.resume &&
      !webhookSecret) ||
      m.synthetic === true ||
      /^whsec_[A-Za-z0-9]+$/.test(webhookSecret || ""),
    "LISTENER_SECRET_REQUIRED",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-runtime-"));
  fs.chmodSync(dir, 0o700);
  const privateDir = path.join(dir, "private");
  fs.mkdirSync(privateDir, { mode: 0o700 });
  const appDir = path.join(dir, "app");
  const token = randomBytes(32).toString("hex"),
    forward = randomBytes(32).toString("hex"),
    secret = webhookSecret || "whsec_" + randomBytes(32).toString("hex"),
    policy =
      browserState?.policy ??
      (m.postClose ? new PostClosePolicy(m, reserve) : new Policy(m, reserve));
  if (browserState)
    check(
      browserState.policy.m === m &&
        !policy.stopped &&
        /^plus-[a-f0-9]{32}--$/.test(browserState.cookieNamespace),
      "BROWSER_CONTINUITY_REQUIRED",
    );
  const cookieNamespace =
    browserState?.cookieNamespace ??
    `plus-${randomBytes(16).toString("hex")}--`;
  policy.signedEvent = (e, raw) => policy.signed(e, raw);
  const authorize = policy.authorize.bind(policy);
  policy.authorize = (r) => {
    try {
      return authorize(r);
    } catch (e) {
      record({
        event: "policy_denied",
        method: r.method,
        path: new URL(r.url).pathname,
      });
      throw e;
    }
  };
  let app,
    broker,
    closing = false,
    failure = null;
  const stop = (code) => {
    policy.stopped = true;
    failure ??= code;
    record({ event: "stop", code });
    onStop(code);
  };
  try {
    broker = await startBroker({
      policy,
      token,
      port: 5219,
      transport: (r) => {
        check(
          !authOnly || new URL(r.url).origin === TARGET.supabase,
          "PREKEY_STRIPE_DENIED",
        );
        return transport(r);
      },
      webhookSecret: () => secret,
      forwardToken: forward,
      onStop: stop,
      onDeny: () => record({ event: "denied" }),
      onAccepted: (type, data) => evidence?.accepted(type, data),
      onWebhookSuccess: (raw) => evidence?.delivered(raw),
      forward: async (raw, sig, key) => {
        const r = await fetch(TARGET.app + "/api/webhooks/stripe", {
          method: "POST",
          headers: {
            "stripe-signature": sig,
            "x-payment-forward": key,
            "content-type": "application/json",
          },
          body: raw,
        });
        return { status: r.status, text: await r.text() };
      },
    });
    copyApplication(repo, appDir);
    fs.cpSync(
      path.join(repo, "scripts/phase6/subscription-runtime"),
      path.join(appDir, "scripts/phase6/subscription-runtime"),
      { recursive: true },
    );
    app = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        sandboxProfile(privateDir, 5219),
        process.execPath,
        "--import",
        "./scripts/phase6/subscription-runtime/fetch.mjs",
        "./scripts/phase6/subscription-runtime/server.mjs",
      ],
      {
        cwd: appDir,
        env: {
          ...environment(m, token, forward, secret),
          SUBSCRIPTION_AUTH_ONLY: String(authOnly),
          SUBSCRIPTION_POST_CLOSE: String(!!m.postClose),
          SUBSCRIPTION_BROWSER_COOKIE_NAMESPACE: cookieNamespace,
        },
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    app.on("message", (x) => {
      if (x?.http) record({ event: "http", ...x.http });
      if (x?.connectionDiagnostic) record(x.connectionDiagnostic);
    });
    app.on("exit", () => {
      if (!closing) stop("APP_EXIT");
    });
    await waitReady(app);
    return {
      dir,
      privateDir,
      app,
      policy,
      browserState: { policy, cookieNamespace },
      evidence,
      secret,
      token,
      forward,
      alive: () =>
        !failure &&
        app.exitCode === null &&
        app.signalCode === null &&
        broker.server.listening,
      async stop({ continueAuthenticated = false } = {}) {
        check(
          !continueAuthenticated || (authOnly && !failure && !policy.stopped),
          "AUTH_CONTINUITY_ONLY",
        );
        closing = true;
        if (!continueAuthenticated) policy.stopped = true;
        const stopped = await Promise.allSettled([
          stopChild(app),
          broker.stop(),
        ]);
        fs.rmSync(dir, { recursive: true, force: true });
        check(
          !fs.existsSync(dir) &&
            stopped.every((x) => x.status === "fulfilled") &&
            (app.exitCode !== null || app.signalCode !== null),
        );
        // A successful, planned auth-only shutdown may transfer the same counters
        // and session identities. A failed/stopped runtime cannot be resumed.
        if (continueAuthenticated) policy.stopped = false;
      },
      failure: () => failure,
    };
  } catch (e) {
    closing = true;
    const results = await Promise.allSettled([stopChild(app), broker?.stop()]);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      e.cleanupFailed = true;
    }
    if (
      results.some((x) => x.status === "rejected") ||
      (app && app.exitCode === null && app.signalCode === null)
    )
      e.cleanupFailed = true;
    throw e;
  }
}
// All cleanup outcomes are independent. A failed external cleanup never means complete.
export async function closeAttempt(actions) {
  const result = {};
  for (const name of [
    "stopProcesses",
    "endContracts",
    "deactivatePrice",
    "restorePortalBinding",
    ...(actions.restoreBillingSettings ? ["restoreBillingSettings"] : []),
    ...(actions.verifyRestoration ? ["verifyRestoration"] : []),
    "revokeKeys",
    // Always erase, including after failed/unknown revocation; never reacquire keys.
    "eraseTemporary",
  ]) {
    try {
      check(await actions[name]());
      result[name] = "verified";
    } catch {
      result[name] = "failed_or_unknown";
    }
  }
  return {
    ...result,
    complete: Object.values(result).every((v) => v === "verified"),
  };
}
