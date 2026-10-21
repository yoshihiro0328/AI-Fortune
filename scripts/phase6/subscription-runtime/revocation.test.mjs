import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyRevocation, revokeAndVerify } from "./revocation.mjs";
import { closeAttempt } from "./runtime.mjs";
import { createServer } from "node:http";
import { once } from "node:events";
import { mockWire } from "./wire.mjs";
for (const mode of ["revoked", "still-valid", "timeout", "forbidden"]) {
  test(
    "revocation must observe invalid keys, not any error: " + mode,
    async () => {
      const calls = [];
      const promise = verifyRevocation(async (req) => {
        calls.push(req);
        if (req.role === "app" && mode === "still-valid")
          return { id: "acct_synthetic" };
        const code =
          req.role !== "app" || mode === "revoked"
            ? "api_key_expired"
            : mode === "timeout"
              ? "TIMEOUT_OR_ABORT"
              : "permission_missing";
        throw Object.assign(Error(code), {
          httpStatus:
            code === "api_key_expired"
              ? 401
              : mode === "forbidden"
                ? 403
                : null,
        });
      });
      if (mode === "revoked") assert.equal((await promise).app, "revoked");
      else await assert.rejects(promise, /UNCONFIRMED/);
      assert.deepEqual(
        calls.map((x) => x.role),
        ["listener", "app", "lifecycle"],
      );
      assert(calls.every((x) => x.path === "/v1/account"));
    },
  );
}

for (const mode of [
  "normal",
  "ui-timeout",
  "partial",
  "forbidden",
  "read-timeout",
  "record-failed",
]) {
  test(
    "bounded key closure always verifies before erasure: " + mode,
    async () => {
      const calls = [],
        saved = [];
      let erased = false,
        pending = 0,
        maxPending = 0;
      const actions = Object.fromEntries(
        [
          "stopProcesses",
          "endContracts",
          "deactivatePrice",
          "restorePortalBinding",
        ].map((k) => [k, async () => true]),
      );
      actions.revokeKeys = () =>
        revokeAndVerify({
          timeoutMs: 300,
          revoke: async (signal) => {
            calls.push("ui");
            assert.equal(erased, false);
            if (mode === "ui-timeout")
              await new Promise((_, reject) =>
                signal.addEventListener(
                  "abort",
                  () => reject(Error("timeout")),
                  { once: true },
                ),
              );
            return mode !== "partial";
          },
          wire: async (req) => {
            assert.equal(erased, false);
            calls.push(req.role);
            pending++;
            maxPending = Math.max(maxPending, pending);
            try {
              if (mode === "read-timeout")
                await new Promise((_, reject) =>
                  req.signal.addEventListener(
                    "abort",
                    () => reject(Error("timeout")),
                    { once: true },
                  ),
                );
              await new Promise((resolve) => setImmediate(resolve));
              if (mode === "partial" && req.role === "app") return {};
              throw Object.assign(
                Error(
                  mode === "forbidden"
                    ? "permission_missing"
                    : "api_key_expired",
                ),
                { httpStatus: mode === "forbidden" ? 403 : 401 },
              );
            } finally {
              pending--;
            }
          },
          save: (name, value) => {
            saved.push(structuredClone(value));
            if (mode === "record-failed") throw Error("record");
            return { verified: true };
          },
        });
      actions.eraseTemporary = async () => {
        calls.push("erase");
        erased = true;
        return true;
      };
      const result = await closeAttempt(actions);
      assert.equal(result.complete, ["normal", "ui-timeout"].includes(mode));
      assert.equal(result.eraseTemporary, "verified");
      assert.deepEqual(calls, ["ui", "listener", "app", "lifecycle", "erase"]);
      assert.equal(maxPending, 3);
      assert.equal(saved.length, 1);
      if (mode === "ui-timeout") assert.equal(saved[0].ui, "unconfirmed");
      if (mode === "partial") assert.equal(saved[0].api.app, "still_valid");
    },
  );
}

test("key closure cannot expand its existing time limit", async () => {
  await assert.rejects(revokeAndVerify({ timeoutMs: 60001 }));
});

for (const forbidden of [false, true]) {
  test(
    "real loopback sender verifies each existing key once before erasure: " +
      forbidden,
    async () => {
      const seen = [],
        saved = [];
      let erased = false;
      const server = createServer((req, res) => {
        assert.equal(erased, false);
        assert.equal(req.method, "GET");
        assert.equal(req.url, "/v1/account");
        const key = req.headers.authorization;
        seen.push(key);
        const denied = forbidden && key.endsWith("App");
        res.writeHead(denied ? 403 : 401, {
          "content-type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: { code: denied ? "permission_missing" : "api_key_expired" },
          }),
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const wire = mockWire({
          origin: `http://127.0.0.1:${server.address().port}`,
          secrets: {
            listener: "rk_test_syntheticListener",
            app: "rk_test_syntheticApp",
            lifecycle: "rk_test_syntheticLifecycle",
          },
        });
        const actions = Object.fromEntries(
          [
            "stopProcesses",
            "endContracts",
            "deactivatePrice",
            "restorePortalBinding",
          ].map((k) => [k, async () => true]),
        );
        actions.revokeKeys = () =>
          revokeAndVerify({
            revoke: async () => true,
            wire,
            save: (name, value) => {
              saved.push(value);
              return { verified: true };
            },
          });
        actions.eraseTemporary = async () => {
          erased = true;
          return true;
        };
        const result = await closeAttempt(actions);
        assert.equal(result.complete, !forbidden);
        assert.equal(result.eraseTemporary, "verified");
        assert.equal(new Set(seen).size, 3);
        assert.equal(seen.length, 3);
        assert.equal(saved[0].api.app, forbidden ? "unknown" : "revoked");
        assert.equal(JSON.stringify(saved).includes("rk_test_"), false);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );
}
