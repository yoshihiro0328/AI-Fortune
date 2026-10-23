import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { TARGET, check, validate } from "./policy.mjs";
import { providerWire } from "./wire.mjs";
import { startRuntime } from "./runtime.mjs";
import { appTransport } from "./app-transport.mjs";
import { workLogin } from "./work-login.mjs";
import { testPassword } from "./test-password.mjs";
import { sessionEvidence } from "./evidence.mjs";
import { keyReceiver } from "./key-receiver.mjs";

// Explicit post-close continuation. Only one optional Portal Session is created;
// there is no Checkout, subscription, payment, listener, event replay or AI path.
const [base] = process.argv.slice(2);
check(
  path.isAbsolute(base) && process.stdin.isTTY,
  "PRIVATE_BASE_AND_TTY_REQUIRED",
);
process.umask(0o077);
const prior = path.join(base, "private-plus-retained-2d81ac35");
const closure = JSON.parse(
  fs.readFileSync(path.join(prior, "closure-final.json")),
);
check(
  closure.completion.closure.complete &&
    closure.revocation.apiComplete &&
    closure.temporaryFilesRemaining.length === 0,
);
const oldKey = fs.readFileSync(path.join(prior, "evidence.key"));
const raw = fs.readFileSync(path.join(prior, "evidence/private-plan.enc"));
const decipher = crypto.createDecipheriv(
  "aes-256-gcm",
  oldKey,
  raw.subarray(0, 12),
);
decipher.setAuthTag(raw.subarray(12, 28));
const old = JSON.parse(
  Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]),
);
oldKey.fill(0);
const m = old.manifest;
validate(m);
check(
  m.account === TARGET.account &&
    m.project === TARGET.ref &&
    m.c.id === "74a7ac25-66f2-450e-a6a4-c72e498fd638" &&
    m.d.id === "ff82e4fe-6de5-4dde-887f-9ae7e8caf89b" &&
    m.customer === "cus_VTu4n49mO4oVRg" &&
    m.portal === "bpc_1USwGkI73kTcvXz8e7AfCnvj" &&
    m.resume?.approval?.resetDedicatedPasswords === true &&
    m.resume?.approval?.reactivateRetainedPortal === true,
  "RETAINED_TARGET_REQUIRED",
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
  "UNAPPROVED_RUNTIME_OVERRIDE",
);
m.postClose = {
  subscription: "sub_1UTg3hI73kTcvXz8bbbuwStW",
  invoice: "in_1UTg3gI73kTcvXz8qXuX9qcr",
  endedAt: 1792752812,
};
m.sessionSecret = crypto.randomBytes(32).toString("hex");
for (const role of ["c", "d"])
  m[role].cookie = crypto.randomBytes(24).toString("hex");
const id = crypto.randomUUID(),
  root = path.join(base, "private-plus-post-close-" + id.slice(0, 8));
fs.mkdirSync(root, { mode: 0o700 });
const report = {
  id,
  sourceAttempt: closure.attemptId,
  scope: "post-close-no-purchase",
  keyName: "yorisoi-postclose-" + id.slice(0, 8),
  keys: 1,
  oldPortalUrlStatus: "unverified_not_reused",
  notificationTransition: "unverified",
  events: [],
  verification: [],
  restoration: {},
  closed: false,
};
const save = () =>
  fs.writeFileSync(
    path.join(root, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
const loaded = JSON.parse(
  fs.readFileSync(path.join(base, "private-auth-step6/runtime.json")),
);
check(loaded.NEXT_PUBLIC_SUPABASE_URL === TARGET.supabase, "TARGET_MISMATCH");
const secrets = {
  anon: loaded.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  service: loaded.SUPABASE_SERVICE_ROLE_KEY,
};
for (const [name, role] of [
  ["anon", "anon"],
  ["service", "service_role"],
]) {
  const claims = JSON.parse(
    Buffer.from(secrets[name].split(".")[1], "base64url"),
  );
  check(
    claims.ref === TARGET.ref && claims.role === role,
    "DB_CREDENTIAL_SCOPE_MISMATCH",
  );
}
const passwords = { c: testPassword(), d: testPassword() };
let runtime,
  receiver,
  phase = "auth",
  deadline = Date.now() + 20 * 60000,
  remaining,
  secretDeadline,
  closing = false,
  dbOriginal,
  configOriginal,
  dbAttempted = false,
  configAttempted = false,
  revocationUntil,
  lines,
  erasing = false,
  cleanupSignal;
const executionAbort = new AbortController();
const wire = providerWire({
  secrets,
  passwordResetUsers: [m.c.id, m.d.id],
  record: (x) => {
    report.events.push(x);
    save();
  },
});
const login = workLogin(m, passwords);
const evidence = sessionEvidence({
  m,
  wire,
  save: (_n, v) => {
    report.verification.push(
      v.rls
        ? { rls: Object.values(v.rls) }
        : v.ownerLogins
          ? { ownerLogins: v.ownerLogins }
          : { verified: true },
    );
    save();
    return { verified: true };
  },
});
const emit = (x) => console.log(JSON.stringify(x));
const stripe = (method, p, body, operation) =>
  wire({
    provider: "stripe",
    role: "app",
    method,
    path: p,
    body,
    operation,
    signal: cleanupSignal ?? executionAbort.signal,
  });
const database = (method, p, body, operation) =>
  wire({
    provider: "supabase",
    role: "service",
    method,
    path: "/rest/v1/" + p,
    body,
    operation,
    signal: cleanupSignal ?? executionAbort.signal,
  });
const transport = appTransport({
  wire,
  login,
  signal: executionAbort.signal,
  operations: {
    state: () => ({ stopped: closing }),
    runtimeFailed: () => {
      report.transportFailed = true;
      void cleanup("transport_failed");
    },
  },
});
async function erase() {
  if (erasing) return;
  erasing = true;
  await receiver?.close().catch(() => {});
  login.close();
  evidence.erase();
  delete secrets.app;
  delete secrets.lifecycle;
  delete secrets.service;
  delete secrets.anon;
  passwords.c = "";
  passwords.d = "";
  for (const k of Object.keys(loaded)) delete loaded[k];
  fs.rmSync(path.join(root, "stripe-keys.json"), { force: true });
  report.temporaryCredentialsDeleted = !fs.existsSync(
    path.join(root, "stripe-keys.json"),
  );
  report.closed = true;
  report.closureComplete =
    Object.values(report.restoration).every(
      (v) => v === "verified" || v === "unchanged",
    ) &&
    report.revocation?.api === "revoked" &&
    report.temporaryCredentialsDeleted;
  report.portalSessionCreated = runtime?.policy?.counts.get("portal") === 1;
  report.newPortalUrlStatus = report.portalSessionCreated
    ? "expiry_unverified_not_reused"
    : "not_created";
  fs.rmSync(path.join(root, "input-ui.json"), { force: true });
  phase = "closed";
  save();
  clearInterval(watch);
  lines?.close();
  emit({
    closed: true,
    report: path.join(root, "result.json"),
    restoration: report.restoration,
    revocation: report.revocation ?? "unconfirmed",
    temporaryCredentialsDeleted: report.temporaryCredentialsDeleted,
  });
}
async function cleanup(reason) {
  if (closing) return;
  closing = true;
  executionAbort.abort();
  report.reason = reason;
  phase = "cleanup";
  save();
  const finishBy = Date.now() + 60000;
  cleanupSignal = AbortSignal.timeout(60000);
  await wire.settle();
  async function step(name, fn) {
    try {
      check(Date.now() < finishBy);
      await fn();
      report.restoration[name] = "verified";
    } catch {
      report.restoration[name] = "unconfirmed";
    }
    save();
  }
  await step("processesStopped", async () => {
    await runtime?.stop();
    check(!runtime?.alive());
  });
  if (dbAttempted)
    await step("portalBinding", async () => {
      const rows = await database(
        "GET",
        "service_settings?select=portal_configuration_id",
        undefined,
        "postclose_restore_read",
      );
      check(rows.length === 1);
      if (rows[0].portal_configuration_id !== dbOriginal) {
        check(rows[0].portal_configuration_id === m.portal);
        await database(
          "PATCH",
          "service_settings?id=eq.true",
          { portal_configuration_id: dbOriginal },
          "postclose_restore_binding",
        );
      }
      const verify = await database(
        "GET",
        "service_settings?select=portal_configuration_id",
        undefined,
        "postclose_verify_binding",
      );
      check(verify[0].portal_configuration_id === dbOriginal);
    });
  if (configAttempted)
    await step("portalConfiguration", async () => {
      const current = await stripe(
        "GET",
        "/v1/billing_portal/configurations/" + m.portal,
        undefined,
        "postclose_restore_read",
      );
      if (current.active !== configOriginal.active) {
        check(current.active === true);
        await stripe(
          "POST",
          "/v1/billing_portal/configurations/" + m.portal,
          { active: false },
          "postclose_restore_portal",
        );
      }
      const verify = await stripe(
        "GET",
        "/v1/billing_portal/configurations/" + m.portal,
        undefined,
        "postclose_verify_portal",
      );
      check(
        verify.active === false &&
          JSON.stringify(verify.features) ===
            JSON.stringify(configOriginal.features),
      );
    });
  await step("priceUnpublished", async () => {
    const rows = await database(
      "GET",
      "price_versions?select=active&id=eq." + m.version,
      undefined,
      "postclose_verify_price",
    );
    check(rows.length === 1 && rows[0].active === false);
  });
  if (!dbAttempted) report.restoration.portalBinding = "unchanged";
  if (!configAttempted) report.restoration.portalConfiguration = "unchanged";
  cleanupSignal = undefined;
  if (secrets.app || receiver?.status().received) {
    phase = "revoke";
    revocationUntil = Math.min(Date.now() + 300000, secretDeadline - 20000);
    emit({
      revokeKey: report.keyName,
      remainingMs: Math.max(0, revocationUntil - Date.now()),
    });
    save();
  } else await erase();
}
async function command(cmd) {
  if (cmd === "status") {
    emit({
      phase,
      alive: runtime?.alive(),
      receiver: receiver?.status(),
      trialRemainingMs:
        phase === "owner" ? remaining : Math.max(0, deadline - Date.now()),
      credentialRemainingMs: secretDeadline
        ? Math.max(0, secretDeadline - Date.now())
        : null,
    });
    return;
  }
  if (cmd === "stop") return cleanup("operator_stop");
  if (cmd === "ready") {
    check(phase === "auth");
    await evidence.logins(executionAbort.signal);
    remaining = deadline - Date.now();
    check(remaining > 0);
    phase = "owner";
    receiver = await keyReceiver({
      directory: root,
      purpose: "post-close",
      onSubmission: () => {
        secretDeadline ??= Date.now() + 7200000;
      },
    });
    fs.writeFileSync(
      path.join(root, "input-ui.json"),
      JSON.stringify({ url: receiver.url }),
      { mode: 0o600 },
    );
    emit({ ready: true, keyName: report.keyName, root, form: receiver.url });
    save();
    return;
  }
  if (cmd === "run") {
    check(phase === "owner" && receiver.status().received);
    phase = "running";
    deadline = Date.now() + remaining;
    const received = JSON.parse(
      fs.readFileSync(path.join(root, "stripe-keys.json")),
    );
    check(
      Object.keys(received).join() === "app" &&
        /^rk_test_[A-Za-z0-9]+$/.test(received.app),
    );
    secrets.app = received.app;
    secrets.lifecycle = received.app;
    const account = await stripe(
      "GET",
      "/v1/account",
      undefined,
      "postclose_account",
    );
    check(account.id === m.account);
    const subs = await stripe(
      "GET",
      "/v1/subscriptions?customer=" + m.customer + "&status=all&limit=10",
      undefined,
      "postclose_subscriptions",
    );
    check(
      subs.has_more === false &&
        subs.data.length === 2 &&
        subs.data.every(
          (s) =>
            [m.postClose.subscription, m.resume.history.subscription].includes(
              s.id,
            ) &&
            s.status === "canceled" &&
            s.livemode === false &&
            s.customer === m.customer,
        ),
    );
    check(
      subs.data.find((s) => s.id === m.postClose.subscription).ended_at ===
        m.postClose.endedAt,
    );
    report.remoteCanceled = true;
    configOriginal = await stripe(
      "GET",
      "/v1/billing_portal/configurations/" + m.portal,
      undefined,
      "postclose_configuration",
    );
    check(
      configOriginal.id === m.portal &&
        configOriginal.livemode === false &&
        configOriginal.active === false &&
        [
          "customer_update",
          "payment_method_update",
          "subscription_cancel",
          "subscription_update",
          "subscription_pause",
        ].every((k) => configOriginal.features[k].enabled === false),
    );
    const settings = await database(
      "GET",
      "service_settings?select=portal_configuration_id",
      undefined,
      "postclose_settings",
    );
    check(settings.length === 1);
    dbOriginal = settings[0].portal_configuration_id;
    check(dbOriginal === "bpc_1UQlv6I73kTcvXz8G4TVvwUm");
    check(!closing);
    configAttempted = true;
    save();
    const activated = await stripe(
      "POST",
      "/v1/billing_portal/configurations/" + m.portal,
      { active: true },
      "postclose_enable_portal",
    );
    check(
      activated.active &&
        JSON.stringify(activated.features) ===
          JSON.stringify(configOriginal.features),
    );
    check(!closing);
    dbAttempted = true;
    save();
    await database(
      "PATCH",
      "service_settings?id=eq.true",
      { portal_configuration_id: m.portal },
      "postclose_portal_binding",
    );
    check(!closing);
    const state = runtime.browserState;
    await runtime.stop({ continueAuthenticated: true });
    check(!closing);
    runtime = await startRuntime({
      m,
      transport,
      evidence,
      browserState: state,
      webhookSecret: "whsec_NoListenerPostClose",
      onStop: () => void cleanup("runtime_stopped"),
      record: (x) => {
        report.events.push(x);
        save();
      },
    });
    emit({ running: true, purchasesAllowed: 0, portalLimit: 1 });
    save();
    return;
  }
  if (cmd === "verify") {
    check(phase === "running");
    await evidence.rls(1, 1, executionAbort.signal);
    const rows = await database(
      "GET",
      "subscriptions?select=id,status,ended_at&user_id=eq." + m.c.id,
      undefined,
      "postclose_verify_database",
    );
    check(
      rows.length === 2 &&
        rows.every((s) => s.status === "canceled" && s.ended_at),
    );
    const entitlement = await database(
      "POST",
      "rpc/consultation_entitlement",
      { p_user: m.c.id },
      "postclose_entitlement",
    );
    check(entitlement?.plan === "free", "FREE_REQUIRED");
    report.currentContractRows = rows;
    report.currentEntitlement = entitlement;
    report.currentStateSource = "app_read_reconciliation_not_webhook";
    save();
    emit({ databaseCanceled: true, entitlement, rlsVerified: true });
    return;
  }
  if (cmd === "finish") {
    check(phase === "running");
    return cleanup("verification_finished");
  }
  if (cmd === "revoked") {
    check(phase === "revoke" && Date.now() < revocationUntil);
    report.revocation = { owner: "confirmed", api: "unconfirmed" };
    try {
      check(secrets.app && Date.now() < secretDeadline - 5000);
      cleanupSignal = AbortSignal.timeout(15000);
      await stripe("GET", "/v1/account", undefined, "verify_key_revocation");
      report.revocation.api = "still_valid";
    } catch (e) {
      report.revocation.api =
        e.httpStatus === 401 &&
        ["api_key_expired", "api_key_invalid", "invalid_api_key"].includes(
          e.message,
        )
          ? "revoked"
          : "unconfirmed";
    } finally {
      await erase();
    }
    return;
  }
  throw Error("COMMAND_DENIED");
}
const watch = setInterval(() => {
  if (phase === "revoke" && Date.now() >= revocationUntil) {
    report.revocation = { owner: "unconfirmed", api: "unconfirmed" };
    void erase();
  } else if (secretDeadline && Date.now() >= secretDeadline) {
    if (closing) void erase();
    else void cleanup("credential_deadline");
  } else if (["auth", "running"].includes(phase) && Date.now() >= deadline)
    void cleanup("trial_deadline");
}, 250);
process.once("SIGINT", () => void cleanup("interrupted"));
process.once("SIGTERM", () => void cleanup("interrupted"));
try {
  for (const role of ["c", "d"]) {
    const u = await wire({
      provider: "supabase",
      role: "service",
      path: "/auth/v1/admin/users/" + m[role].id,
      operation: "postclose_user_check",
      signal: executionAbort.signal,
    });
    check((u.user ?? u).email === m[role].email);
    await wire({
      provider: "supabase",
      role: "service",
      method: "PUT",
      path: "/auth/v1/admin/users/" + m[role].id,
      body: { password: passwords[role] },
      operation: "reset_retained_password",
      signal: executionAbort.signal,
    });
  }
  runtime = await startRuntime({
    m,
    transport,
    evidence,
    authOnly: true,
    onStop: () => void cleanup("runtime_stopped"),
    record: (x) => {
      report.events.push(x);
      save();
    },
  });
  emit({ authReady: true, root, keyName: report.keyName, app: TARGET.app });
  save();
  lines = readline.createInterface({ input: process.stdin });
  for await (const line of lines) {
    try {
      await command(line.trim());
    } catch {
      report.commandFailed = true;
      await cleanup("command_failed");
    }
  }
  if (!closing) await cleanup("input_closed");
} catch {
  await cleanup("startup_failed");
}
