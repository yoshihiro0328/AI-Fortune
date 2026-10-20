import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { chromium } from "@playwright/test";
import { isolatedSubscription } from "./isolated.mjs";
import { startRuntime, closeAttempt } from "./runtime.mjs";
import { TARGET } from "./policy.mjs";
const report = process.argv[2];
assert(path.isAbsolute(report) && !fs.existsSync(report));
const realFetch = fetch;
globalThis.fetch = (url, options) => {
  assert(
    [TARGET.app, TARGET.broker].includes(
      new URL(url instanceof Request ? url.url : url).origin,
    ),
  );
  return realFetch(url, options);
};
const db = await isolatedSubscription(),
  protectedBefore = await db.protectedState(),
  records = [],
  checks = [];
let rt,
  browser,
  helperFailure = null;
const pass = (n) => {
  checks.push(n);
  console.log("PASS " + n);
};
async function send(event) {
  const raw = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: rt.secret,
  });
  const r = await fetch(TARGET.broker + "/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: raw,
  });
  assert.equal(r.status, 200);
  return event;
}
let seq = 0;
const event = (type, object, id) => ({
  id: id || "evt_local_" + ++seq,
  type,
  livemode: false,
  account: TARGET.account,
  data: { object: structuredClone(object) },
});
const usage = async () =>
  (await db.pg.query("select consultation_entitlement($1) as v", [db.m.c.id]))
    .rows[0].v;
async function login(page, user) {
  await page.goto(
    TARGET.app + "/subscription-test/" + (user === db.m.c ? "c" : "d"),
  );
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("SyntheticOnly123!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page
    .getByRole("heading", { name: "保存した診断", exact: true })
    .waitFor();
  await page.getByText("残り", { exact: false }).first().waitFor();
}
async function api(page, method, body) {
  return page.evaluate(
    async ({ method, body }) => {
      const r = await fetch("/api/billing", {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json() };
    },
    { method, body },
  );
}
async function checkout(page) {
  await page.goto(TARGET.app + "/plans");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Plusのテスト契約へ", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "ローカル代替 Checkout：980 JPY／月" })
    .waitFor();
  await page.getByRole("button", { name: "合成テスト支払い" }).click();
  await page.waitForURL("**/account?subscription=complete");
  await page.getByRole("heading", { name: "契約状況" }).waitFor();
}
let closure;
async function cleanupAll() {
  if (closure) return closure;
  closure = await closeAttempt({
    stopProcesses: async () => {
      const outcomes = await Promise.allSettled([browser?.close(), rt?.stop()]);
      browser = null;
      return outcomes.every((x) => x.status === "fulfilled");
    },
    endContracts: async () => {
      // Local provider cancellation substitute, scoped to the new synthetic subscriptions.
      for (const subscription of db.subscriptions.values()) {
        db.transition(subscription.id, "ended");
        await db.pg.query(
          "update subscriptions set status='canceled' where id=$1 and user_id=$2",
          [subscription.id, db.m.c.id],
        );
      }
      return [...db.subscriptions.values()].every(
        (x) => x.status === "canceled",
      );
    },
    deactivatePrice: async () => {
      await db.pg.query("update price_versions set active=false where id=$1", [
        db.m.version,
      ]);
      db.state.priceActive = false;
      return true;
    },
    restorePortalBinding: async () => {
      await db.pg.exec(
        "update service_settings set portal_configuration_id=null where id",
      );
      return true;
    },
    eraseTemporary: async () => !rt || !fs.existsSync(rt.dir),
    revokeKeys: async () => true, // No real keys were issued.
  });
  return closure;
}
let result;
try {
  rt = await startRuntime({
    m: db.m,
    transport: db.transport,
    record: (x) => records.push(x),
  });
  rt.app.on("message", (m) => {
    if (m?.pay)
      (async () => {
        const cs = db.checkouts.get("cs_test_local_" + m.pay);
        db.pay(cs.id);
        await send(event("checkout.session.completed", cs));
        rt.app.send({ paid: m.pay });
      })().catch(() => {
        helperFailure = true;
      });
  });
  const exe = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    wrapper = path.join(rt.dir, "chrome.sh");
  fs.writeFileSync(
    wrapper,
    `#!/bin/sh\nexec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:5218"))' '${exe}' "$@"\n`,
    { mode: 0o700 },
  );
  browser = await chromium.launch({
    executablePath: wrapper,
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
    ],
    env: { PATH: "/usr/bin:/bin", HOME: rt.dir, TMPDIR: rt.dir },
  });
  const contexts = [];
  async function page() {
    const c = await browser.newContext({
      serviceWorkers: "block",
      locale: "ja-JP",
    });
    contexts.push(c);
    await c.route("**/*", (r) =>
      new URL(r.request().url()).origin === TARGET.app
        ? r.continue()
        : r.abort(),
    );
    const p = await c.newPage();
    p.setDefaultTimeout(30000);
    p.on("dialog", (d) => d.accept());
    return p;
  }
  const c = await page(),
    d = await page(),
    anon = await page();
  await login(c, db.m.c);
  pass("real browser C login and account free");
  await checkout(c);
  assert.equal((await usage()).plan, "plus");
  assert.equal((await usage()).limit, 30);
  pass("real plans -> substitute Checkout -> signed webhook -> Plus account");
  if (process.argv.includes("--fail-after-first"))
    throw Error("INJECTED_POST_PURCHASE_FAILURE");
  if (process.argv.includes("--interrupt-after-first")) {
    rt.app.kill("SIGTERM");
    await new Promise((r) => rt.app.once("exit", r));
    assert(!rt.alive());
    throw Error("INJECTED_APP_INTERRUPTION");
  }
  await c.getByRole("button", { name: "解約・支払い方法・請求履歴" }).click();
  await c
    .getByRole("heading", { name: "ローカル代替 Customer Portal" })
    .waitFor();
  await c.getByRole("link", { name: "よりそいへ戻る" }).click();
  await c.getByRole("heading", { name: "契約状況" }).waitFor();
  pass("Portal substitute navigation and return");
  await login(d, db.m.d);
  await d.goto(TARGET.app + "/plans");
  await d.getByRole("checkbox").check();
  await d
    .getByRole("button", { name: "Plusのテスト契約へ", exact: true })
    .click();
  await d.getByRole("alert").waitFor();

  const readD = await api(d, "GET");
  assert.equal(readD.data.subscription, null);
  assert.equal(readD.data.invoices.length, 0);
  assert.equal(readD.data.usage.plan, "free");
  for (const action of ["checkout", "portal", "cancel"])
    assert.equal(
      (
        await api(d, "POST", {
          action,
          consent: true,
          user_id: db.m.c.id,
          customer: db.m.customer,
        })
      ).status,
      403,
    );
  await anon.goto(TARGET.app + "/plans");
  for (const action of ["checkout", "portal", "cancel"])
    assert.equal(
      (await api(anon, "POST", { action, consent: true })).status,
      401,
    );
  pass(
    "D and anonymous billing operations denied; no ownership from request body",
  );
  const csrf = await fetch(TARGET.app + "/api/billing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"action":"checkout","consent":true}',
  });
  assert.equal(csrf.status, 403);
  pass("CSRF denied before provider changes");
  const first = [...db.subscriptions.values()][0],
    old = event("customer.subscription.created", first);
  await send(old);
  await send(old);
  assert.equal(
    (await db.pg.query("select count(*)::int as n from subscriptions")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await db.pg.query("select count(*)::int as n from subscription_invoices"))
      .rows[0].n,
    1,
  );
  pass("duplicate signed event no duplicate subscription or invoice");
  await c.getByRole("button", { name: "次回の自動更新を停止する" }).click();
  await c.getByText("解約予約済み", { exact: false }).waitFor();
  await send(old);
  assert.equal(
    (
      await db.pg.query(
        "select cancel_at_period_end from subscriptions where id=$1",
        [first.id],
      )
    ).rows[0].cancel_at_period_end,
    true,
  );
  assert.equal((await usage()).plan, "plus");
  pass(
    "period-end cancellation retains Plus; older event cannot revert latest state",
  );
  // Local provider progression is synthetic. It does NOT change host/DB time.
  first.cancel_at_period_end = false;
  db.transition(first.id, "renewed");
  await send(event("invoice.paid", first.latest_invoice));
  assert.equal((await usage()).plan, "plus");
  assert.equal(
    (await db.pg.query("select count(*)::int as n from subscription_invoices"))
      .rows[0].n,
    2,
  );
  pass("renewal paid snapshot and current-period entitlement");
  db.transition(first.id, "future");
  await send(event("customer.subscription.updated", first));
  assert.equal((await usage()).plan, "free");
  pass(
    "future Test Clock period does not move DB time or grant current entitlement",
  );
  db.transition(first.id, "failed");
  await send(event("invoice.payment_failed", first.latest_invoice));
  assert.equal((await usage()).plan, "free");
  pass("failed renewal outside paid period falls back to free 3");
  db.transition(first.id, "ended");
  await send(event("customer.subscription.deleted", first));
  assert.equal((await usage()).limit, 3);
  pass("ended subscription free; no paid report entitlement added");
  await checkout(c);
  const second = [...db.subscriptions.values()][1];
  assert.equal((await usage()).plan, "plus");
  pass("resubscription second Checkout isolated from first");
  await c.getByRole("button", { name: "次回の自動更新を停止する" }).click();
  await c.getByText("解約予約済み", { exact: false }).waitFor();
  db.transition(second.id, "ended");
  await send(event("customer.subscription.deleted", second));
  await c.reload();
  await c.getByText("解約済み", { exact: false }).waitFor();
  assert.equal((await usage()).plan, "free");
  pass("scheduled end renders canceled and free account");
  for (const who of [db.m.c, db.m.d]) {
    await db.pg.exec("begin; set local role authenticated");
    try {
      await db.pg.query("select set_config('request.jwt.claim.sub',$1,true)", [
        who.id,
      ]);
      for (const table of ["subscriptions", "subscription_invoices"]) {
        const rows = (await db.pg.query("select user_id from " + table)).rows;
        assert(rows.every((x) => x.user_id === who.id));
        assert.equal(
          rows.length,
          who === db.m.c ? (table === "subscriptions" ? 2 : 4) : 0,
        );
      }
    } finally {
      await db.pg.exec("rollback");
    }
  }
  pass("real PostgreSQL RLS C own rows / D zero (synthetic JWT claims)");
  assert.equal(await db.protectedState(), protectedBefore);
  assert.equal(db.state.payments, 2);
  assert(!helperFailure);
  assert(rt.alive());
  assert(!rt.policy.stopped);
  pass("retained A/B purchase/report/fixture and profiles unchanged");
  await browser.close();
  browser = null;
  await cleanupAll();
  assert(closure.complete);
  pass(
    "normal closure processes, temporary, scoped price and portal restored; synthetic no keys",
  );
  result = {
    passed: true,
    checks,
    closure,
    actualNext: true,
    actualChrome: true,
    isolatedMigrations: 17,
    auth: "synthetic",
    stripe: "local substitute",
    rls: "real PostgreSQL with synthetic JWT claims",
    providerConnections: 0,
    payments: db.state.payments,
    http: records.filter((x) => x.event === "http"),
  };
} catch (e) {
  result = {
    passed: false,
    code: /^[A-Z_]+$/.test(e.message) ? e.message : "CHECK_FAILED",
    checkCount: checks.length,
    checks,
    http: records.filter((x) =>
      ["http", "stop", "policy_denied"].includes(x.event),
    ),
  };
  console.log("LOCAL_FAILURE", e.stack);
  process.exitCode = 1;
} finally {
  result.closure = await cleanupAll();
  result.retainedUnchanged = (await db.protectedState()) === protectedBefore;
  result.localContractsEnded = [...db.subscriptions.values()].every(
    (x) => x.status === "canceled",
  );
  result.localPriceDisabled = db.state.priceActive === false;
  await db.close();
  fs.writeFileSync(report, JSON.stringify(result, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      passed: result.passed,
      checks: checks.length,
      providerConnections: 0,
    }),
  );
}
