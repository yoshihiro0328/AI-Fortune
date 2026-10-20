import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { isolatedSubscription } from "./isolated.mjs";
import { observePreflight } from "./journal.mjs";
import { runPreparedAttempt } from "./launch.mjs";
import { TARGET } from "./policy.mjs";
for (const mode of [
  "normal",
  "preflight-mismatch",
  "listener-mismatch",
  "app-failure",
  "startup-cleanup-failed",
  "app-stop-failed",
  "missing-api-version",
])
  test("prepared supervisor with migrated DB: " + mode, async () => {
    const db = await isolatedSubscription();
    db.m.apiVersion =
      mode === "missing-api-version" ? undefined : "2026-09-30.endive";
    const read = async (p) =>
      JSON.parse(
        (
          await db.transport({
            method: "GET",
            url: TARGET.supabase + "/rest/v1/" + p,
            headers: { apikey: "local-service" },
          })
        ).text,
      );
    const expected = await observePreflight(db.m, read),
      input = new PassThrough(),
      output = new PassThrough();
    input.isTTY = true;
    let live = false,
      app = false,
      executed = 0,
      cleanupCalls = 0;
    if (mode === "preflight-mismatch") expected.settings = [];
    const actions = Object.fromEntries(
      [
        "endContracts",
        "deactivatePrice",
        "restorePortalBinding",
        "eraseTemporary",
        "revokeKeys",
      ].map((k) => [
        k,
        async () => {
          cleanupCalls++;
          return true;
        },
      ]),
    );
    const p = runPreparedAttempt({
      m: db.m,
      read,
      expected,
      transport: db.transport,
      input,
      output,
      timeoutMs: 2000,
      listener: {
        start: async () => {
          live = true;
          return {
            account:
              mode === "listener-mismatch" ? "acct_wrong" : TARGET.account,
            apiVersion: db.m.apiVersion,
            secret: "whsec_synthetic",
          };
        },
        alive: () => live,
        stop: async () => {
          live = false;
        },
      },
      runtimeFactory: async () => {
        if (mode === "app-failure") throw Error("synthetic");
        if (mode === "startup-cleanup-failed")
          throw Object.assign(Error("synthetic"), { cleanupFailed: true });
        app = true;
        return {
          alive: () => app,
          stop: async () => {
            app = false;
            if (mode === "app-stop-failed") throw Error("synthetic");
          },
        };
      },
      execute: async () => {
        executed++;
        return true;
      },
      cleanup: actions,
    });
    output.on("data", (x) => {
      if (String(x).startsWith("ready:"))
        setImmediate(() =>
          input.write("status\nportal-check\nlifecycle-check\nfinish\n"),
        );
    });
    try {
      const r = await p;
      assert.equal(r.complete, mode === "normal");
      assert.equal(
        r.closure.complete,
        !["startup-cleanup-failed", "app-stop-failed"].includes(mode),
      );
      assert.equal(
        executed,
        ["normal", "app-stop-failed"].includes(mode) ? 3 : 0,
      );
      assert.equal(cleanupCalls, 5);
      assert(!live && !app);
    } finally {
      input.destroy();
      output.destroy();
      await db.close();
    }
  });
