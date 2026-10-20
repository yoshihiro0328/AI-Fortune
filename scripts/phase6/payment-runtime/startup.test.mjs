import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { isolatedPayment } from "./preflight-isolated.mjs";
import { TARGET, hash } from "./policy.mjs";
import { run } from "./launch.mjs";
import { startBroker } from "./broker.mjs";
import { startListener, waitReady } from "./processes.mjs";

for (const scenario of [
  "ready",
  "old-query",
  "malformed",
  "account-mismatch",
  "network-failure",
  "listener-failure",
  "app-failure",
  "app-timeout",
  "interrupted",
  "cleanup-failure",
  "noninteractive",
  "startup-input-end",
  "ready-input-end",
  "ready-input-error",
  "ready-hangup",
])
  test(
    "portable launcher + migrated PostgreSQL + supervised process stand-ins: " +
      scenario,
    async () => {
      const db = await isolatedPayment();
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "payment-startup-isolated-"),
      );
      fs.chmodSync(dir, 0o700);
      const input = path.join(dir, "input");
      const stdin = new PassThrough();
      stdin.isTTY = scenario !== "noninteractive";
      const children = [];
      let broker, policy;
      const binary = path.join(dir, "fake-stripe");
      fs.writeFileSync(
        binary,
        scenario === "listener-failure"
          ? "#!/bin/sh\nexit 1\n"
          : '#!/bin/sh\nprintf "Ready whsec_syntheticOnly\\n"\nexec /bin/sleep 30\n',
        { mode: 0o700 },
      );
      const key = (role) =>
        [
          "e30",
          Buffer.from(JSON.stringify({ ref: TARGET.ref, role })).toString(
            "base64url",
          ),
          "synthetic",
        ].join(".");
      const attemptId = randomUUID();
      const c = {
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
          anon: key("anon"),
          service: key("service_role"),
          stripe: "rk_test_syntheticApp",
          listener: "rk_test_syntheticListener",
        },
      };
      fs.writeFileSync(input, JSON.stringify(c), { mode: 0o600 });
      // Preserve the previous attempt byte-for-byte and keep the original fixture run.
      const previous = path.join(
        dir,
        "payment-" + c.previousAttemptId + ".jsonl",
      );
      fs.writeFileSync(previous, "retained previous STOP\n", { mode: 0o600 });
      const snapshot = async () =>
        JSON.stringify(
          (
            await db.pg.query(
              "select jsonb_build_object('diagnoses',(select jsonb_agg(to_jsonb(d)) from diagnoses d),'answers',(select jsonb_agg(to_jsonb(a)) from diagnosis_answers a),'reports',(select jsonb_agg(to_jsonb(f)) from free_reports f),'profiles',(select jsonb_agg(to_jsonb(p) order by id) from profiles p),'users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u)) as state",
            )
          ).rows,
        );
      const before = await snapshot();
      let endedDuringStartup = false;
      const provider = async (r) => {
        if (scenario === "startup-input-end" && !endedDuringStartup) {
          endedDuringStartup = true;
          stdin.end();
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (r.url.includes("billing_customers?")) {
          if (scenario === "old-query")
            return db.transport({
              ...r,
              url: r.url.replace("select=user_id", "select=id"),
            });
          if (scenario === "malformed") return { status: 200, text: "null" };
          if (scenario === "network-failure")
            throw Error("DO_NOT_RECORD_CONNECTION_DETAILS");
        }
        if (scenario === "account-mismatch" && r.url.endsWith("/v1/account"))
          return { status: 200, text: '{"id":"acct_wrong"}' };
        if (scenario === "cleanup-failure" && r.method === "PATCH")
          return { status: 503, text: '{"message":"DO_NOT_RECORD_RESPONSE"}' };
        return db.transport(r);
      };
      try {
        const code = await run(input, process.cwd(), {
          stdin,
          providerTransport: () => provider,
          startBroker: async (options) => {
            policy = options.policy;
            assert.equal(policy.ready, false);
            broker = await startBroker({
              ...options,
              port: scenario === "ready" ? 5209 : 0,
            });
            return broker;
          },
          startListener: (options) => {
            const p = startListener(options);
            children.push(p.child);
            return p;
          },
          // This suite runs on Linux CI. The real Next app and OS sandbox are
          // exercised separately by offline-http/offline-control on macOS.
          startApp: () => {
            const source =
              scenario === "app-failure"
                ? "process.exit(1)"
                : scenario === "app-timeout"
                  ? "setInterval(()=>{},1000)"
                  : "setTimeout(()=>process.send({ready:true}),30);setInterval(()=>{},1000)";
            const child = spawn(process.execPath, ["-e", source], {
              detached: true,
              env: { PATH: "/usr/bin:/bin" },
              stdio: ["ignore", "ignore", "ignore", "ipc"],
            });
            children.push(child);
            return child;
          },
          waitReady: async (child) => {
            if (scenario === "interrupted") {
              process.emit("SIGINT");
              return;
            }
            await waitReady(
              child,
              scenario === "app-timeout"
                ? 60
                : scenario === "ready"
                  ? 45000
                  : 3000,
            );
            setTimeout(() => {
              if (scenario === "ready-input-end") stdin.end();
              else if (scenario === "ready-input-error")
                stdin.destroy(Error("PRIVATE_INPUT_ERROR"));
              else if (scenario === "ready-hangup") process.emit("SIGHUP");
              else stdin.write("status\nfinish\n");
            }, 30);
          },
        });
        assert.equal(code, 2); // Local teardown never falsely claims Dashboard key revocation.
        assert(!fs.existsSync(input));
        const journal = fs.readFileSync(
          path.join(dir, "payment-" + attemptId + ".jsonl"),
          "utf8",
        );
        const rows = journal.trim().split("\n").map(JSON.parse);
        assert.equal(rows[0].run, attemptId);
        assert.equal(rows[0].fixtureRun, db.manifest.run);
        assert.equal(rows[0].previousAttempt, db.manifest.run);
        assert.equal(
          fs.readFileSync(previous, "utf8"),
          "retained previous STOP\n",
        );
        const ready = [
          "ready",
          "cleanup-failure",
          "ready-input-end",
          "ready-input-error",
          "ready-hangup",
        ].includes(scenario);
        assert.equal(
          rows.some((r) => r.event === "ready"),
          ready,
          JSON.stringify(rows.filter((r) => r.event === "execution_failed")),
        );
        if (!ready) assert(rows.some((r) => r.event === "execution_failed"));
        const expectedOperation = {
          "old-query": "billing_customers",
          malformed: "billing_customers",
          "network-failure": "billing_customers",
          "account-mismatch": "app_account",
          "listener-failure": "listener_start",
          "app-failure": "application_ready",
          "app-timeout": "application_ready",
          interrupted: "application_ready",
          noninteractive: "control_attach",
          "startup-input-end": "prices",
        }[scenario];
        if (expectedOperation)
          assert.equal(
            rows.find((r) => r.event === "execution_failed").operation,
            expectedOperation,
          );
        if (scenario === "old-query")
          assert(
            rows.some(
              (r) =>
                r.event === "execution_failed" &&
                r.stage === "preflight" &&
                r.operation === "billing_customers" &&
                r.httpStatus === 400 &&
                r.errorCode === "42703",
            ),
          );
        if (scenario === "malformed")
          assert(
            rows.some(
              (r) =>
                r.event === "execution_failed" &&
                r.httpStatus === 200 &&
                r.errorCode === "RESPONSE_SHAPE_INVALID",
            ),
          );
        if (scenario === "app-timeout")
          assert(
            rows.some(
              (r) =>
                r.event === "execution_failed" &&
                r.operation === "application_ready" &&
                r.errorCode === "START_TIMEOUT",
            ),
          );
        const closure = rows.find((r) => r.event === "closure");
        const stopReason = {
          "startup-input-end": "input_closed",
          "ready-input-end": "input_closed",
          "ready-input-error": "input_error",
          "ready-hangup": "input_hangup",
        }[scenario];
        if (stopReason) assert.equal(closure.reason, stopReason);
        if (scenario === "noninteractive") {
          assert(
            rows.some(
              (r) =>
                r.event === "execution_failed" &&
                r.errorCode === "INTERACTIVE_INPUT_REQUIRED",
            ),
          );
          assert.equal(children.length, 0);
          assert(!rows.some((r) => r.stage === "preflight"));
        }
        if (["ready", "cleanup-failure"].includes(scenario)) {
          const status = rows.find((r) => r.event === "control_status");
          assert.equal(status.ready, true);
          assert.equal(status.applicationAlive, true);
          assert.equal(status.listenerAlive, true);
          assert.equal(status.brokerListening, true);
        }
        assert.equal(closure.processes, "stopped");
        assert.equal(closure.temporary, "deleted");
        assert.equal(closure.complete, false);
        assert.equal(
          closure.price,
          scenario === "cleanup-failure"
            ? "failed_or_unknown"
            : "verified_inactive",
        );
        assert.equal(
          (
            await db.pg.query(
              "select count(*)::int as n from price_versions where active",
            )
          ).rows[0].n,
          scenario === "cleanup-failure" ? 1 : 0,
        );
        assert.equal(await snapshot(), before);
        assert(
          children.every((c) => c.exitCode !== null || c.signalCode !== null),
        );
        if (broker) assert.equal(broker.server.listening, false);
        if (policy) {
          assert(policy.stopped);
          assert.throws(
            () =>
              policy.authorize({
                method: "POST",
                url: TARGET.stripe + "/v1/checkout/sessions",
              }),
            /NOT_READY/,
          );
        }
        assert(
          !db.calls.some(
            (r) =>
              r.method === "POST" ||
              r.method === "DELETE" ||
              r.path.includes("/auth/"),
          ),
        );
        assert(
          !journal.includes("DO_NOT_RECORD") &&
            !journal.includes("PRIVATE_INPUT_ERROR") &&
            !journal.includes("rk_test_") &&
            !journal.includes("whsec_") &&
            !journal.includes("@example.invalid") &&
            !journal.includes(c.manifest.anonymousHash),
        );
      } finally {
        stdin.destroy();
        await db.pg.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
