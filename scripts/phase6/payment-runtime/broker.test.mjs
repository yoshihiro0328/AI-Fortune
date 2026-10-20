import test from "node:test";
import assert from "node:assert/strict";
import { Policy, TARGET } from "./policy.mjs";
import { startBroker } from "./broker.mjs";
import { m } from "./offline-fixture.mjs";
for (const kind of ["timeout", "http-failure", "binding-mismatch"])
  test("broker freezes after " + kind + " and never retries", async () => {
    const p = new Policy(m);
    p.ready = true;
    let calls = 0,
      stops = 0;
    const broker = await startBroker({
      policy: p,
      port: 0,
      token: "synthetic",
      webhookSecret: () => "",
      forwardToken: "synthetic",
      forward: async () => {
        throw Error();
      },
      onStop: () => stops++,
      transport: async () => {
        calls++;
        if (kind === "timeout") throw Error("TIMEOUT");
        return {
          status: kind === "http-failure" ? 500 : 200,
          text: JSON.stringify({ id: "acct_wrong" }),
        };
      },
    });
    const request = () =>
      fetch("http://127.0.0.1:" + broker.port + "/proxy", {
        method: "POST",
        headers: { "x-payment-token": "synthetic" },
        body: JSON.stringify({
          method: "GET",
          url: TARGET.stripe + "/v1/account",
          headers: { authorization: "Bearer rk_test_local_proxy" },
        }),
      });
    try {
      assert.equal((await request()).status, 403);
      assert(p.stopped);
      assert.equal((await request()).status, 403);
      assert.equal(calls, 1);
      assert.equal(stops, 1);
    } finally {
      await broker.stop();
    }
  });
test("missing broker credential and forbidden destinations never invoke transport", async () => {
  const p = new Policy(m);
  p.ready = true;
  let calls = 0;
  const broker = await startBroker({
    policy: p,
    port: 0,
    token: "synthetic",
    webhookSecret: () => "",
    forwardToken: "synthetic",
    forward: async () => {
      throw Error();
    },
    transport: async () => {
      calls++;
      throw Error();
    },
  });
  try {
    for (const token of ["", "synthetic"]) {
      const r = await fetch("http://127.0.0.1:" + broker.port + "/proxy", {
        method: "POST",
        headers: { "x-payment-token": token },
        body: JSON.stringify({
          url: "https://api.openai.com/v1/responses",
          method: "POST",
          headers: {},
          body: "{}",
        }),
      });
      assert.equal(r.status, 403);
    }
    assert.equal(calls, 0);
  } finally {
    await broker.stop();
  }
});

test("authorized control channel with a forbidden request stops all later provider sends", async () => {
  const policy = new Policy(m);
  policy.ready = true;
  let calls = 0,
    stops = 0;
  const broker = await startBroker({
    policy,
    port: 0,
    token: "synthetic",
    transport: async () => {
      calls++;
      return { status: 200, text: "{}" };
    },
    onStop: () => stops++,
  });
  const send = (url) =>
    fetch(`http://127.0.0.1:${broker.port}/proxy`, {
      method: "POST",
      headers: { "x-payment-token": "synthetic" },
      body: JSON.stringify({
        url,
        method: "GET",
        headers: { authorization: "Bearer rk_test_local_proxy" },
      }),
    });
  try {
    assert.equal((await send("https://forbidden.invalid/")).status, 403);
    assert.equal(policy.stopped, true);
    assert.equal((await send(TARGET.stripe + "/v1/account")).status, 403);
    assert.equal(calls, 0);
    assert.equal(stops, 1);
  } finally {
    await broker.stop();
  }
});
