import test from "node:test";
import assert from "node:assert/strict";
import { startBroker } from "./network.mjs";
import { startContinuationBroker } from "../payment-continuation/network.mjs";
import { diagnostic } from "../payment-runtime/diagnostics.mjs";

for (const [name, start] of [
  ["verification", startBroker],
  ["continuation", startContinuationBroker],
])
  for (const failure of ["denied", "timeout", "bad-response"])
    test(`${name}: ${failure} freezes the broker before any later transport`, async () => {
      let calls = 0;
      const stops = [],
        records = [];
      const policy = {
        stopped: false,
        authorize(r) {
          assert.equal(this.stopped, false);
          if (r.denied) throw Error("PRIVATE_DIAGNOSTIC");
          return { kind: "read:diagnoses" };
        },
        accept() {
          if (failure === "bad-response") throw Error("PRIVATE_DIAGNOSTIC");
        },
      };
      const broker = await start({
        policy,
        port: 0,
        token: "synthetic-only",
        record: (event, data) => records.push({ event, ...data }),
        onStop: (reason) => stops.push(reason),
        transport: async () => {
          calls++;
          if (failure === "timeout") throw Error("PRIVATE_DIAGNOSTIC");
          return { status: 200, text: "[]" };
        },
      });
      const send = (denied) =>
        fetch(`http://127.0.0.1:${broker.server.address().port}/proxy`, {
          method: "POST",
          headers: { "x-payment-token": "synthetic-only" },
          body: JSON.stringify({ denied, method: "GET" }),
        });
      try {
        assert.equal((await send(failure === "denied")).status, 403);
        assert.equal(policy.stopped, true);
        assert.equal((await send(false)).status, 403);
        assert.equal(calls, failure === "denied" ? 0 : 1);
        assert(stops.length > 0);
        assert(!JSON.stringify(records).includes("PRIVATE_DIAGNOSTIC"));
      } finally {
        await broker.stop();
      }
    });

test("uppercase text is not implicitly safe to persist as an error code", () => {
  assert.equal(
    diagnostic(Error("PRIVATE_DIAGNOSTIC")).errorCode,
    "UNCLASSIFIED",
  );
  assert.equal(
    diagnostic(Error("RATE_BASELINE_CHANGED")).errorCode,
    "RATE_BASELINE_CHANGED",
  );
});
