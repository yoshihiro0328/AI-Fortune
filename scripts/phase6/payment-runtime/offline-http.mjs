// Loopback-only test. Never imports live credentials, starts Stripe CLI, or contacts a provider.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { Policy, TARGET } from "./policy.mjs";
import { startBroker } from "./broker.mjs";
import { m, session, mockProvider } from "./offline-fixture.mjs";
import { appEnvironment, copyApplication } from "./launch.mjs";
import {
  startApp,
  waitReady,
  stopChild,
  sandboxProfile,
} from "./processes.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "payment-offline-"));
fs.chmodSync(root, 0o700);
const privateDir = path.join(root, "private");
fs.mkdirSync(privateDir, { mode: 0o700 });
fs.writeFileSync(path.join(privateDir, "fake-secret"), "SYNTHETIC_ONLY");
const results = [];
let broker, app, trap;
const p = new Policy(m);
p.ready = true;
const { transport, state } = mockProvider();
let denied = 0;
const token = "synthetic-broker",
  forwardToken = "synthetic-forward",
  secret = "whsec_synthetic_only";
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log("PASS " + name);
}
async function request(jar, url, options = {}) {
  const r = await fetch(TARGET.app + url, {
    ...options,
    headers: {
      ...options.headers,
      host: "localhost:5208",
      cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
      origin: TARGET.app,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(60000),
  });
  for (const c of r.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return r;
}
try {
  broker = await startBroker({
    onDeny: () => denied++,
    policy: p,
    token,
    forwardToken,
    transport: async (r) => {
      try {
        return await transport(r);
      } catch {
        throw Error("OFFLINE_TRANSPORT");
      }
    },
    webhookSecret: () => secret,
    forward: async (raw, sig, key) => {
      const r = await fetch("http://127.0.0.1:5208/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "stripe-signature": sig,
          "x-payment-forward": key,
          "content-type": "application/json",
          host: "localhost:5208",
        },
        body: raw,
      });
      return { status: r.status, text: await r.text() };
    },
  });
  let trapHits = 0;
  trap = http.createServer((req, res) => {
    trapHits++;
    res.end("MUST_NOT_REACH");
  });
  await new Promise((r) => trap.listen(0, "127.0.0.1", r));
  const trapPort = trap.address().port;
  await check(
    "OS sandbox blocks direct HTTP, raw TCP, child-process bypass and credential reads",
    async () => {
      const source = `import http from 'node:http';import net from 'node:net';import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const deny=fn=>new Promise((resolve,reject)=>{const s=fn();s.on('error',()=>resolve());s.on('connect',()=>reject(Error('BYPASS')));s.setTimeout?.(1500,()=>{s.destroy();reject(Error('TIMEOUT_NOT_DENIAL'));});});
await deny(()=>net.connect(${trapPort},'127.0.0.1'));
await new Promise((resolve,reject)=>{http.get('http://127.0.0.1:${trapPort}',()=>reject(Error('HTTP_BYPASS'))).on('error',resolve);});
let denied=false;try{fs.readFileSync(${JSON.stringify(path.join(privateDir, "fake-secret"))});}catch{denied=true;}if(!denied)throw Error('FILE_BYPASS');
const child=spawnSync(process.execPath,['--input-type=module','-e',"import net from 'node:net';let s=net.connect(${trapPort},'127.0.0.1');s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));"],{timeout:3000});if(child.status!==0)throw Error('CHILD_BYPASS');
const r=await fetch('http://127.0.0.1:5209/proxy',{method:'POST',headers:{'x-payment-token':'${token}'},body:JSON.stringify({url:'https://api.openai.com/v1/models',method:'GET',headers:{}})});if(r.status!==403)throw Error('BROKER_BYPASS');console.log('offline isolation passed');`;
      const child = spawn(
        "/usr/bin/sandbox-exec",
        [
          "-p",
          sandboxProfile(privateDir),
          process.execPath,
          "--input-type=module",
          "-e",
          source,
        ],
        { env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] },
      );
      let err = "";
      child.stderr.on("data", (x) => (err += x));
      const code = await new Promise((r) => child.on("exit", r));
      assert.equal(code, 0, err);
      assert.equal(trapHits, 0);
    },
  );
  const appDir = path.join(root, "app");
  copyApplication(process.cwd(), appDir);
  app = startApp({
    cwd: appDir,
    env: appEnvironment(m, { token, forward: forwardToken, webhook: secret }),
    privateDir,
  });
  await waitReady(app);
  const a = new Map(),
    b = new Map();
  for (const [label, user, jar] of [
    ["a", m.a, a],
    ["b", m.b, b],
  ])
    await check(
      "real Next login " + label + " through broker to synthetic Auth",
      async () => {
        assert.equal(
          (await request(jar, "/payment-test/start/" + label)).status,
          303,
        );
        const r = await request(jar, "/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "login",
            email: user.email,
            password: "SyntheticOnly123!",
          }),
        });
        assert.equal(r.status, 200, await r.text());
      },
    );
  const endpoint = "/api/diagnoses/" + m.diagnosis;
  await check("real API rejects buyer B Checkout", async () => {
    assert.equal(
      (await request(b, endpoint + "/checkout", { method: "POST" })).status,
      404,
    );
  });
  await check(
    "real API rejects missing CSRF without provider writes",
    async () => {
      const count = state.calls.length;
      const r = await fetch(TARGET.app + endpoint + "/checkout", {
        method: "POST",
        headers: { host: "localhost:5208" },
      });
      assert.equal(r.status, 403);
      assert.equal(state.calls.length, count);
    },
  );
  await check(
    "real Checkout route and Stripe SDK pass exact form through broker once",
    async () => {
      const r = await request(a, endpoint + "/checkout", { method: "POST" });
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal((await r.json()).url, session.url);
      assert.equal(p.counts.get("checkout"), 1);
    },
  );
  await check("buyer has no paid access before webhook", async () =>
    assert.equal((await request(a, endpoint + "/report")).status, 403),
  );
  await check("direct webhook bypass rejected", async () =>
    assert.equal(
      (await request(a, "/api/webhooks/stripe", { method: "POST", body: "{}" }))
        .status,
      403,
    ),
  );
  const raw = JSON.stringify({
    id: "evt_synthetic",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        ...session,
        payment_status: "paid",
        payment_intent: "pi_fixture",
      },
    },
  });
  const sig = Stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret,
  });
  await check(
    "invalid webhook signature rejected before forwarding",
    async () => {
      const r = await fetch("http://127.0.0.1:5209/webhook", {
        method: "POST",
        headers: { "stripe-signature": "invalid" },
        body: raw,
      });
      assert.equal(r.status, 403);
      assert.equal(state.paidReports, 0);
    },
  );
  for (const n of [1, 2])
    await check(
      "signed webhook " +
        n +
        " traverses real handler, authoritative reads and scoped RPC",
      async () => {
        const r = await fetch("http://127.0.0.1:5209/webhook", {
          method: "POST",
          headers: { "stripe-signature": sig },
          body: raw,
        });
        assert.equal(r.status, 200, await r.text());
        assert.equal(state.paidReports, 1);
      },
    );
  await check(
    "third webhook delivery refused without additional RPC",
    async () => {
      const n = state.calls.length;
      assert.equal(
        (
          await fetch("http://127.0.0.1:5209/webhook", {
            method: "POST",
            headers: { "stripe-signature": sig },
            body: raw,
          })
        ).status,
        403,
      );
      assert.equal(state.calls.length, n);
    },
  );
  await check("real paid report API allows A and rejects B", async () => {
    const r = await request(a, endpoint + "/report");
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).status, "queued");
    assert.equal((await request(b, endpoint + "/report")).status, 404);
  });
  await check("real router blocks AI generation and signup", async () => {
    assert.equal(
      (await request(a, endpoint + "/report", { method: "POST" })).status,
      403,
    );
    assert.equal(
      (
        await request(a, "/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "signup",
            email: m.a.email,
            password: "SyntheticOnly123!",
            consent: true,
          }),
        })
      ).status,
      403,
    );
  });
  await check(
    "no OpenAI, refunds, subscriptions or second Checkout reached transport",
    async () => {
      assert(
        !state.calls.some((s) => /openai|refund|subscription|signup/.test(s)),
      );
      assert.equal(
        state.calls.filter((s) => s === "POST /v1/checkout/sessions").length,
        1,
      );
    },
  );
  await check("child terminated on explicit shutdown", async () => {
    await stopChild(app);
    assert(app.exitCode !== null || app.signalCode !== null);
  });
  console.log(
    JSON.stringify({
      checks: results.length,
      passed: results.length,
      providerConnections: 0,
      realCredentials: false,
      skipped: 0,
    }),
  );
} catch (e) {
  console.error("OFFLINE_TEST_FAILED", e.message);
  process.exitCode = 1;
} finally {
  await stopChild(app);
  await broker?.stop();
  if (trap) await new Promise((r) => trap.close(r));
  fs.rmSync(root, { recursive: true, force: true });
  void denied;
}
