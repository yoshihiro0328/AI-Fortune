import { test } from "node:test";
import assert from "node:assert/strict";
import { startBroker } from "../payment-runtime/broker.mjs";
import { isolatedSubscription } from "./isolated.mjs";
import { Policy, TARGET } from "./policy.mjs";
for (const cause of [
  "unauthorized",
  "upstream-error",
  "wrong-account",
  "timeout",
])
  test("broker stops subsequent traffic on " + cause, async () => {
    const d = await isolatedSubscription(),
      policy = new Policy(d.m);
    let calls = 0,
      stops = 0;
    const b = await startBroker({
      policy,
      token: "synthetic-token",
      port: 0,
      onStop: () => stops++,
      transport: async (r) => {
        calls++;
        if (cause === "upstream-error" || cause === "timeout")
          throw Error("synthetic");
        if (cause === "wrong-account")
          return { status: 200, text: '{"id":"acct_wrong"}' };
        return d.transport(r);
      },
    });
    const send = () =>
      fetch("http://127.0.0.1:" + b.port + "/proxy", {
        method: "POST",
        headers: { "x-payment-token": "synthetic-token" },
        body: JSON.stringify({
          method: "GET",
          url:
            TARGET.stripe +
            (cause === "unauthorized" ? "/v1/events" : "/v1/account"),
          headers: {},
        }),
      });
    try {
      assert.equal((await send()).status, 403);
      const n = calls;
      assert.equal((await send()).status, 403);
      assert.equal(calls, n);
      assert(policy.stopped);
      assert.equal(stops, 1);
    } finally {
      await b.stop();
      await d.close();
    }
  });
