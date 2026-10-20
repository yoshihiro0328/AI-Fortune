// Portable orchestration tests. Browser/Next are explicit stand-ins, not UI evidence.
// Data, ownership and RLS execute in PGlite with the repository migrations.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { run } from "./launch.mjs";
import { isolatedReady } from "./isolated.mjs";
import { TARGET } from "../payment-runtime/policy.mjs";
import { verifyAccess } from "../payment-continuation/verify.mjs";
import {
  snapshot,
  compareBaseline,
  reportBody,
} from "../payment-continuation/state.mjs";
import { waitReady, stopChild } from "../payment-runtime/processes.mjs";

for (const scenario of [
  "complete",
  "input-end",
  "preflight-mismatch",
  "check-failure",
])
  test(
    `ready-report portable lifecycle: ${scenario}`,
    { timeout: 30000 },
    async () => {
      const db = await isolatedReady();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-verify-ci-"));
      fs.chmodSync(dir, 0o700);
      const input = new PassThrough();
      input.isTTY = true;
      const attemptId = randomUUID(),
        file = path.join(dir, "input.json");
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
          project: TARGET.ref,
          account: TARGET.account,
          fixtureDisposition: "reuse",
          attemptId,
          previousAttemptId: randomUUID(),
          manifest: db.m,
          baseline: db.baseline,
          expected: db.expected,
          rateBaseline: [],
          secrets: { anon: key("anon"), service: key("service_role") },
        }),
        { mode: 0o600 },
      );
      const journal = path.join(dir, `verification-${attemptId}.jsonl`);
      const rows = () =>
        fs.existsSync(journal)
          ? fs
              .readFileSync(journal, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map(JSON.parse)
          : [];
      const until = async (predicate) => {
        for (let i = 0; i < 500; i++) {
          if (predicate()) return;
          if (rows().some((x) => x.event === "closure"))
            throw Error("EARLY_TEST_CLOSURE");
          await new Promise((r) => setTimeout(r, 10));
        }
        throw Error("TEST_TIMEOUT");
      };
      const command = async (name) => {
        input.write(name + "\n");
        await until(() =>
          rows().some(
            (x) => x.event === "check_success" && x.operation === name,
          ),
        );
      };
      let app,
        policy,
        browserStopped = false,
        brokerStopped = false,
        beganBrowser = false,
        task;
      try {
        if (scenario === "preflight-mismatch")
          await db.pg.exec("update paid_reports set status='queued'");
        task = run(file, process.cwd(), {
          input,
          transport: db.transport,
          startBroker: async (options) => {
            policy = options.policy;
            return {
              server: { listening: true },
              stop: async () => {
                brokerStopped = true;
              },
            };
          },
          startApp: () => {
            app = spawn(
              process.execPath,
              ["-e", "process.send({ready:true});setInterval(()=>{},1000)"],
              {
                detached: true,
                env: { PATH: "/usr/bin:/bin" },
                stdio: ["ignore", "ignore", "ignore", "ipc"],
              },
            );
            return app;
          },
          waitReady,
          startBrowser: async () => {
            beganBrowser = true;
            const checked = new Set();
            return {
              alive: () => !browserStopped,
              open: async (label) => {
                const user = db.m[label.toLowerCase()];
                const r = {
                  url: TARGET.supabase + "/auth/v1/token?grant_type=password",
                  method: "POST",
                  headers: {
                    apikey: "local-anon",
                    authorization: "Bearer local-anon",
                  },
                  body: JSON.stringify({
                    email: user.email,
                    password: "SyntheticOnly123!",
                  }),
                };
                const ticket = policy.authorize(r),
                  out = await db.transport(r);
                policy.accept(ticket, out.status, JSON.parse(out.text));
              },
              check: async (label) => {
                if (scenario === "check-failure")
                  throw Error("PRIVATE_DIAGNOSTIC");
                checked.add(label);
              },
              anonymous: async () => {
                checked.add("anonymous");
              },
              allChecked: () => checked.size === 3,
              stop: async () => {
                browserStopped = true;
              },
            };
          },
          verify: (...args) =>
            verifyAccess(...args, async (_url, { headers }) => {
              // HTTP response stand-in only; verifyAccess's JWT/RLS reads use real DB roles.
              const a = policy.sessionsData.get(db.m.a.id);
              const { authCookie } =
                await import("../payment-continuation/verify.mjs");
              const own = headers.cookie === authCookie(a);
              return Response.json(
                own
                  ? { status: "ready", report: reportBody(process.cwd()) }
                  : { error: "denied" },
                { status: own ? 200 : headers.cookie ? 404 : 401 },
              );
            }),
        });
        if (scenario !== "preflight-mismatch") {
          await until(() => rows().some((x) => x.event === "ready"));
          // Idle status observations must not consume a login or close control input.
          input.write("status\n");
          await new Promise((r) => setTimeout(r, 30));
          input.write("status\n");
          assert.equal(
            db.calls.filter((x) => x.path === "/auth/v1/token").length,
            0,
          );
          if (scenario === "input-end") input.end();
          else {
            await command("open-a");
            if (scenario === "check-failure") input.write("check-a\n");
            else {
              for (const cmd of [
                "check-a",
                "open-b",
                "check-b",
                "anonymous",
                "verify",
              ])
                await command(cmd);
              input.write("finish\n");
            }
          }
        }
        const code = await task,
          events = rows(),
          closure = events.find((x) => x.event === "closure");
        assert.equal(code, scenario === "complete" ? 0 : 2);
        assert.equal(closure.complete, scenario === "complete");
        assert.equal(closure.cleanupComplete, true);
        assert.equal(closure.bodyWrites, 0);
        assert.equal(closure.psqlConnections, 0);
        assert.equal(closure.stripeCalls, 0);
        assert.equal(closure.priceMutation, false);
        assert.equal(fs.existsSync(file), false);
        assert(
          !fs.readFileSync(journal, "utf8").includes("PRIVATE_DIAGNOSTIC"),
        );
        if (beganBrowser) {
          assert(browserStopped && brokerStopped);
          assert(app.exitCode !== null || app.signalCode !== null);
        }
        if (scenario === "preflight-mismatch")
          assert.equal(beganBrowser, false);
        else compareBaseline(await snapshot(db.read), db.baseline);
        assert(!db.calls.some((x) => ["PATCH", "DELETE"].includes(x.method)));
        if (scenario === "complete") {
          assert.deepEqual(
            events
              .filter((x) => x.event === "rls_access")
              .map((x) => [x.user, x.table, x.rows]),
            [
              ["A", "payments", 1],
              ["A", "paid_reports", 1],
              ["B", "payments", 0],
              ["B", "paid_reports", 0],
            ],
          );
          assert.equal(
            events.filter(
              (x) => x.event === "encrypted_backup" && x.decryptionExact,
            ).length,
            2,
          );
        }
      } finally {
        input.end();
        await task?.catch(() => {});
        await stopChild(app);
        await db.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
