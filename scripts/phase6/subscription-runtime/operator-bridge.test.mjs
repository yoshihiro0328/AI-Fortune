import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { operatorBridge } from "./operator-bridge.mjs";
for (const mode of ["normal", "wrong-id", "timeout", "interrupt", "unknown"]) {
  test("operator mailbox " + mode + " without taking over TTY", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-operator-"));
    fs.chmodSync(root, 0o700);
    const bridge = operatorBridge(root, { timeoutMs: 250 });
    const abort = new AbortController();
    try {
      const promise = bridge.request(
        "price",
        { id: "price_synthetic", active: false },
        abort.signal,
      );
      const request = JSON.parse(
        fs.readFileSync(path.join(root, "request-1.json")),
      );
      if (!["timeout", "interrupt"].includes(mode))
        fs.writeFileSync(
          request.responseFile,
          JSON.stringify({
            id: mode === "wrong-id" ? "invalid" : request.id,
            ok: mode !== "unknown",
            value: true,
          }),
          { mode: 0o600 },
        );
      if (mode === "interrupt") abort.abort();
      if (mode === "normal") assert.equal(await promise, true);
      else await assert.rejects(promise);
      assert(bridge.close());
      assert.deepEqual(fs.readdirSync(root), []);
      await assert.rejects(bridge.request("price"));
    } finally {
      bridge.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test("revocation mailbox reserves time for API verification and erasure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-revoke-"));
  const bridge = operatorBridge(root);
  const abort = new AbortController();
  try {
    const before = Date.now();
    const promise = bridge.request("revoke-keys", { count: 3 }, abort.signal);
    const r = JSON.parse(fs.readFileSync(path.join(root, "request-1.json")));
    assert(r.expiresAt - before >= 40000 && r.expiresAt - before < 41000);
    abort.abort();
    await assert.rejects(promise);
  } finally {
    bridge.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
