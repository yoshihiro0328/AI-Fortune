import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mockWire } from "./wire.mjs";
import { appTransport } from "./app-transport.mjs";
import { TARGET } from "./policy.mjs";
import { startBroker } from "../payment-runtime/broker.mjs";

const secrets = { service: "syntheticService", app: "rk_test_syntheticApp" };
async function upstream(status, text = "") {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) {
      assert(Buffer.isBuffer(chunk));
    }
    calls++;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: "http://127.0.0.1:" + server.address().port,
    calls: () => calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("committed void RPC crosses wire, app transport and broker once as empty 204", async () => {
  const u = await upstream(204);
  const records = [];
  let failed = false,
    accepted = false;
  const wire = mockWire({
    origin: u.origin,
    secrets,
    record: (x) => records.push(x),
  });
  const broker = await startBroker({
    port: 0,
    token: "synthetic",
    policy: {
      authorize: () => ({ kind: "apply_subscription_snapshot" }),
      accept: (t, status, data) => {
        assert.equal(t.kind, "apply_subscription_snapshot");
        assert.equal(status, 204);
        assert.equal(data, null);
        accepted = true;
      },
    },
    transport: appTransport({
      wire,
      operations: {
        state: () => ({ stopped: false }),
        runtimeFailed: () => {
          failed = true;
        },
      },
    }),
    onStop: () => {
      failed = true;
    },
  });
  try {
    const response = await fetch("http://127.0.0.1:" + broker.port + "/proxy", {
      method: "POST",
      headers: { "x-payment-token": "synthetic" },
      body: JSON.stringify({
        method: "POST",
        url: TARGET.supabase + "/rest/v1/rpc/apply_subscription_snapshot",
        headers: { apikey: "local-service" },
        body: "{}",
      }),
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal(accepted, true);
    assert.equal(failed, false);
    assert.equal(u.calls(), 1);
    assert.deepEqual(records, [
      { operation: "application_post_snapshot", httpStatus: 204, code: null },
    ]);
  } finally {
    await broker.stop();
    await u.close();
  }
});

for (const [provider, method, path, status] of [
  ["supabase", "POST", "/rest/v1/rpc/apply_subscription_snapshot", 200],
  ["supabase", "POST", "/rest/v1/rpc/apply_subscription_snapshot", 500],
  ["supabase", "GET", "/rest/v1/rpc/apply_subscription_snapshot", 204],
  ["supabase", "POST", "/rest/v1/rpc/consultation_entitlement", 204],
  ["stripe", "GET", "/v1/account", 204],
])
  test(`unexpected empty response still fails without retry: ${provider} ${method} ${path} ${status}`, async () => {
    const u = await upstream(status);
    try {
      const wire = mockWire({ origin: u.origin, secrets });
      await assert.rejects(
        wire({
          provider,
          role: provider === "stripe" ? "app" : "service",
          method,
          path,
          operation: "synthetic_empty_response",
        }),
        /INVALID_JSON/,
      );
      assert.equal(u.calls(), 1);
    } finally {
      await u.close();
    }
  });
