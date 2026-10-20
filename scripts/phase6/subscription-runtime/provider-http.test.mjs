import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { isolatedSubscription } from "./isolated.mjs";
import { providerOperations } from "./provider-ops.mjs";
import { mockWire } from "./wire.mjs";
import { vault } from "./vault.mjs";
import { PassThrough } from "node:stream";
import { supervisor, privateInput } from "./supervisor.mjs";
import { appTransport } from "./app-transport.mjs";
import { API_VERSION } from "./listener.mjs";
import { TARGET } from "./policy.mjs";
const secrets = {
  app: "rk_test_syntheticApp",
  listener: "rk_test_syntheticListener",
  lifecycle: "rk_test_syntheticLifecycle",
  service: "syntheticService",
  anon: "syntheticAnon",
};
async function fixture(mode, clockApproval) {
  const db = await isolatedSubscription(),
    pg = db.pg;
  await pg.exec("update price_versions set active=false");
  const m = {
    ...db.m,
    apiVersion: API_VERSION,
    c: { ...db.m.c, id: randomUUID() },
    d: { ...db.m.d, id: randomUUID() },
    frozenTime: 1800000000,
  };
  const protectedState = async () => {
    const v = JSON.parse(await db.protectedState());
    v.profiles = v.profiles.filter(
      (x) => ![m.c.id, m.d.id].includes(x.user_id),
    );
    v["auth.users"] = v["auth.users"].filter(
      (x) => ![m.c.id, m.d.id].includes(x.id),
    );
    return JSON.stringify(v);
  };
  const original = await protectedState(),
    objects = {
      price: {
        id: m.price,
        product: m.product,
        active: false,
        livemode: false,
        unit_amount: 980,
        currency: "jpy",
        recurring: { interval: "month", interval_count: 1 },
      },
    };
  const calls = [];
  let failed = false;
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const c of req) text += c;
    const u = new URL(req.url, "http://127.0.0.1"),
      p = u.pathname,
      method = req.method,
      f = new URLSearchParams(text),
      b =
        text && req.headers["content-type"] === "application/json"
          ? JSON.parse(text)
          : {};
    calls.push({
      p,
      method,
      role: req.headers.authorization,
      idempotency: req.headers["idempotency-key"],
    });
    const send = (data, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      if (p === "/v1/account")
        return send({
          id: mode === "wrong-account" ? "acct_wrong" : TARGET.account,
        });
      if (p === "/v1/prices/" + m.price) return send(objects.price);
      if (p === "/auth/v1/admin/users") {
        assert.equal(b.email_confirm, true);
        assert(!m.protectedUsers.includes(b.id));
        await pg.query(
          "insert into auth.users(id,email_confirmed_at) values($1,now())",
          [b.id],
        );
        await pg.query("insert into profiles(user_id) values($1)", [b.id]);
        return send({
          id: b.id,
          email: b.email,
          email_confirmed_at: new Date().toISOString(),
        });
      }
      if (p.startsWith("/rest/v1/")) {
        const table = p.slice("/rest/v1/".length);
        assert(
          [
            "payment_environment",
            "price_versions",
            "service_settings",
            "profiles",
            "subscriptions",
            "subscription_invoices",
            "diagnoses",
            "diagnosis_answers",
            "free_reports",
            "payments",
            "paid_reports",
            "billing_customers",
          ].includes(table),
        );
        const values = [],
          filters = [];
        for (const [key, value] of u.searchParams) {
          if (["select", "order"].includes(key)) continue;
          assert(
            ["id", "user_id", "active", "portal_configuration_id"].includes(
              key,
            ),
          );
          if (value === "is.null") filters.push(key + " is null");
          else {
            assert(value.startsWith("eq."));
            values.push(value.slice(3));
            filters.push(key + "=$" + values.length);
          }
        }
        let query;
        if (method === "GET")
          query =
            "select * from " +
            table +
            (filters.length ? " where " + filters.join(" and ") : "") +
            (u.searchParams.has("order") ? " order by id" : "");
        else if (method === "POST") {
          assert.equal(table, "billing_customers");
          assert.equal(b.user_id, m.c.id);
          const keys = Object.keys(b);
          assert.deepEqual(keys.sort(), [
            "is_test",
            "stripe_customer_id",
            "user_id",
          ]);
          values.push(...keys.map((k) => b[k]));
          query = `insert into ${table}(${keys.join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`;
        } else {
          assert.equal(method, "PATCH");
          assert(["service_settings", "price_versions"].includes(table));
          assert(filters.length > 0);
          const keys = Object.keys(b);
          assert.equal(keys.length, 1);
          assert(["portal_configuration_id", "active"].includes(keys[0]));
          values.push(b[keys[0]]);
          query = `update ${table} set ${keys[0]}=$${values.length} where ${filters.join(" and ")} returning *`;
        }
        return send((await pg.query(query, values)).rows);
      }
      if (p === "/v1/test_helpers/test_clocks") {
        objects.clock = {
          id: "clock_http",
          frozen_time: Number(f.get("frozen_time")),
          status: "ready",
          livemode: false,
        };
        return send(objects.clock);
      }
      if (
        p === "/v1/test_helpers/test_clocks/clock_http" ||
        p === "/v1/test_helpers/test_clocks/clock_http/advance"
      ) {
        if (method === "POST")
          objects.clock.frozen_time = Number(f.get("frozen_time"));
        return send(objects.clock);
      }
      if (p === "/v1/billing_portal/sessions") {
        assert.equal(req.headers.authorization, "Bearer " + secrets.lifecycle);
        return send({
          customer: f.get("customer"),
          configuration: f.get("configuration"),
          return_url: f.get("return_url"),
          url: "https://billing.stripe.com/synthetic",
        });
      }
      if (p === "/v1/payment_methods/pm_card_chargeCustomerFail/attach")
        return send({
          id: "pm_failure",
          customer: f.get("customer"),
          livemode: false,
        });
      if (p === "/v1/customers") {
        if (mode === "permission" && !failed) {
          failed = true;
          return send(
            {
              error: {
                code: "permission_missing",
                message: "private body must not be logged",
              },
            },
            403,
          );
        }
        objects.customer = {
          id: "cus_http",
          test_clock: f.get("test_clock"),
          livemode: false,
          metadata: {
            run: f.get("metadata[run]"),
            user_id: f.get("metadata[user_id]"),
          },
        };
        if (mode === "unknown" && !failed) {
          failed = true;
          req.socket.destroy();
          return;
        }
        if (["interrupt", "timeout"].includes(mode) && !failed) {
          failed = true;
          return;
        }
        return send(objects.customer);
      }
      if (p === "/v1/billing_portal/configurations") {
        objects.portal = {
          id: "bpc_http",
          livemode: false,
          active: true,
          metadata: { run: f.get("metadata[run]") },
        };
        return send(objects.portal);
      }
      if (p === "/v1/billing_portal/configurations/bpc_http") {
        if (method === "POST") {
          if (mode === "cleanup-fail")
            return send({ error: { message: "do not log" } }, 500);
          objects.portal.active = false;
        }
        return send(objects.portal);
      }
      if (p.startsWith("/v1/checkout/sessions/")) {
        const id = p.split("/")[4];
        const c = objects[id];
        assert(c);
        if (p.endsWith("/expire")) {
          assert.equal(req.headers.authorization, "Bearer " + secrets.app);
          c.status = "expired";
        }
        return send(c);
      }
      if (p === "/v1/invoices")
        return send({
          has_more: false,
          data: (objects.invoices ?? []).filter(
            (i) =>
              i.parent.subscription_details.subscription ===
              u.searchParams.get("subscription"),
          ),
        });
      if (p.startsWith("/v1/subscriptions/")) {
        const sub = objects[p.split("/").at(-1)];
        assert(sub);
        if (method === "POST")
          sub.default_payment_method = f.get("default_payment_method");
        if (method === "DELETE") {
          assert.equal(f.get("prorate"), "false");
          assert.equal(f.get("invoice_now"), "false");
          sub.status = "canceled";
        }
        return send(sub);
      }
      throw Error("unmatched local route");
    } catch {
      send({ code: "LOCAL_HANDLER_ERROR" }, 500);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-http-"));
  fs.chmodSync(root, 0o700);
  const store = vault(root, randomBytes(32)),
    records = [],
    abort = new AbortController();
  const wire = mockWire({
    origin: "http://127.0.0.1:" + server.address().port,
    secrets,
    record: (x) => records.push(x),
    timeoutMs: mode === "timeout" ? 100 : 1000,
  });
  const ops = providerOperations({
    m,
    wire,
    clockApproval,
    attemptId: randomUUID(),
    signal: abort.signal,
    save: store.save,
    record: (x) => records.push(x),
    human: {
      price: async (active) => {
        if (mode === "human-price-fail" && !active) return false;
        objects.price.active = active;
        return true;
      },
    },
  });
  return {
    wire,
    store,
    db,
    pg,
    m,
    ops,
    objects,
    protectedState,
    calls,
    records,
    abort,
    root,
    original,
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
for (const mode of [
  "normal",
  "permission",
  "unknown",
  "interrupt",
  "cleanup-fail",
  "human-price-fail",
  "wrong-account",
  "timeout",
])
  test("actual HTTP preparation and migrated-DB cleanup: " + mode, async () => {
    const t = await fixture(mode);
    try {
      const expected = await t.ops.observe();
      if (mode === "wrong-account") {
        await assert.rejects(t.ops.inspect(expected));
        assert.equal(t.calls.filter((c) => c.method !== "GET").length, 0);
        return;
      }
      await t.ops.inspect(expected);
      let pending = t.ops.prepare({
        c: "synthetic-password-C",
        d: "synthetic-password-D",
      });
      if (mode === "interrupt") setTimeout(() => t.abort.abort(), 100);
      if (["permission", "unknown", "interrupt", "timeout"].includes(mode)) {
        await assert.rejects(pending, /RESULT_UNKNOWN_STOP/);
        await assert.rejects(
          t.ops.prepare({
            c: "synthetic-password-C",
            d: "synthetic-password-D",
          }),
        );
      } else {
        await pending;
        t.objects.sub_http = {
          id: "sub_http",
          customer: "cus_http",
          livemode: false,
          status: "active",
          default_payment_method: "pm_good",
          metadata: { user_id: t.m.c.id },
          items: { data: [{ price: { id: t.m.price } }] },
        };
        for (const [id, status, subscription] of [
          ["cs_test_http_paid", "complete", "sub_http"],
          ["cs_test_http_open", "open", null],
        ]) {
          t.objects[id] = {
            id,
            status,
            subscription,
            customer: "cus_http",
            mode: "subscription",
            amount_total: 980,
            currency: "jpy",
            livemode: false,
            metadata: { user_id: t.m.c.id },
          };
          await t.ops.bindCheckout(id);
        }
      }
      if (mode === "normal") {
        await t.ops.compatibilityPortal();
        const transport = appTransport({
          wire: t.wire,
          operations: t.ops,
          signal: t.abort.signal,
        });
        t.ops.reserveRuntime("portal", 1);
        const p = await transport({
          method: "POST",
          url: TARGET.stripe + "/v1/billing_portal/sessions",
          headers: {},
          body: new URLSearchParams({
            customer: "cus_http",
            configuration: "bpc_http",
            return_url: TARGET.app + "/account",
          }).toString(),
        });
        assert.equal(p.status, 200);
        assert.throws(
          () => t.ops.reserveRuntime("portal", 2),
          /OPERATION_LIMIT/,
        );
        await t.ops.paymentMethod("sub_http", true);
        assert.equal(t.objects.sub_http.default_payment_method, "pm_failure");
        await t.ops.paymentMethod("sub_http", false);
        assert.equal(t.objects.sub_http.default_payment_method, "pm_good");
        for (let i = 1; i <= 3; i++)
          await t.ops.advanceClock(t.m.frozenTime + i * 3600);
        await assert.rejects(
          t.ops.advanceClock(t.m.frozenTime + 4 * 3600),
          /OPERATION_LIMIT/,
        );
      }
      const result = await t.ops.cleanup();
      assert.equal(result.complete, mode === "normal");
      if (mode === "normal") {
        assert.equal(t.objects.sub_http.status, "canceled");
        assert.equal(t.objects.cs_test_http_open.status, "expired");
        assert.equal(t.objects.price.active, false);
        assert.equal(t.objects.portal.active, false);
        assert((await t.ops.inspectAfter()).protectedUnchanged);
      }
      assert.equal(await t.protectedState(), t.original);
      assert(
        t.calls.filter((c) => c.p === "/v1/customers" && c.method === "POST")
          .length <= 1,
      );
      assert(!JSON.stringify(t.records).includes("private body"));
      assert(!JSON.stringify(t.records).includes("synthetic-password"));
      assert(!JSON.stringify(t.records).includes("rk_test_"));
      assert(fs.readdirSync(t.root).every((f) => f.endsWith(".enc")));
      if (mode === "human-price-fail") {
        assert.equal(result.deactivatePrice, "failed_or_unknown");
        assert.equal(t.objects.portal.active, false);
        assert.equal(
          (
            await t.pg.query("select active from price_versions where id=$1", [
              t.m.version,
            ])
          ).rows[0].active,
          false,
        );
      }
      if (mode === "cleanup-fail")
        assert.equal(result.restorePortalBinding, "failed_or_unknown");
    } finally {
      await t.close();
    }
  });
test("mock wire cannot use real-looking credentials or non-loopback endpoint", () => {
  assert.throws(() => mockWire({ origin: "https://api.stripe.com", secrets }));
  assert.throws(() =>
    mockWire({
      origin: "http://127.0.0.1:1",
      secrets: { ...secrets, app: "rk_test_other" },
    }),
  );
});
test("encrypted backup is owner-only, verified, and never overwrites an existing record", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-vault-"));
  fs.chmodSync(dir, 0o700);
  try {
    const v = vault(dir, randomBytes(32));
    assert(v.save("before.enc", { synthetic: "private fixture" }).verified);
    assert.throws(() => v.save("before.enc", {}));
    assert.equal(fs.statSync(path.join(dir, "before.enc")).mode & 0o077, 0);
    assert(
      !fs
        .readFileSync(path.join(dir, "before.enc"))
        .includes(Buffer.from("private fixture")),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const scenario of ["normal", "unknown", "interrupt", "postcheck-mismatch"])
  test(
    "same supervisor with real mock HTTP, private-input erasure and final closure: " +
      scenario,
    async () => {
      const t = await fixture(scenario === "unknown" ? "unknown" : "normal");
      const input = new PassThrough(),
        output = new PassThrough();
      input.isTTY = true;
      const tmp = path.join(t.root, "input.json");
      fs.writeFileSync(tmp, JSON.stringify({ synthetic: true }), {
        mode: 0o600,
      });
      let app = false,
        cli = false,
        revocations = 0,
        ready = false;
      try {
        assert(privateInput(tmp, t.root).synthetic);
        const s = supervisor({
          m: t.m,
          attemptId: randomUUID(),
          wire: t.wire,
          save: t.store.save,
          record: (x) => t.records.push(x),
          human: {
            price: async (active) => {
              t.objects.price.active = active;
              return true;
            },
            revokeKeys: async () => {
              revocations++;
              return true;
            },
          },
          listener: {
            start: async () => {
              cli = true;
              return {
                account: TARGET.account,
                apiVersion: t.m.apiVersion,
                secret: "whsec_synthetic",
              };
            },
            stop: async () => {
              cli = false;
            },
            alive: () => cli,
          },
          input,
          output,
          temporary: { file: tmp, root: t.root },
          timeoutMs: 10000,
          runtimeFactory: async () => {
            app = true;
            return {
              alive: () => app,
              stop: async () => {
                app = false;
              },
            };
          },
          execute: async () => true,
        });
        output.on("data", (x) => {
          if (String(x).startsWith("ready:")) {
            ready = true;
            setImmediate(() => {
              if (scenario === "interrupt") input.end();
              else {
                if (scenario === "postcheck-mismatch")
                  t.pg
                    .exec("update service_settings set plus_limit=31")
                    .then(() => input.write("finish\n"));
                else
                  input.write(
                    "status\nportal-check\nlifecycle-check\nfinish\n",
                  );
              }
            });
          }
        });
        const result = await s.run(await s.operations.observe(), {
          c: "synthetic-password-C",
          d: "synthetic-password-D",
        });
        assert.equal(result.complete, scenario === "normal");
        assert.deepEqual(
          t.records
            .filter((r) => r.event === "provider_finished")
            .map((r) => r.complete),
          [scenario === "normal"],
        );
        assert(fs.existsSync(path.join(t.root, "completion.enc")));
        assert.equal(result.exitCode, scenario === "normal" ? 0 : 2);
        assert.equal(ready, scenario !== "unknown");
        assert(!app && !cli);
        assert.equal(revocations, 1);
        assert(!fs.existsSync(tmp));
        assert.equal(t.objects.price.active, false);
        if (t.objects.portal) assert.equal(t.objects.portal.active, false);
        assert(!JSON.stringify(t.records).includes("rk_test_"));
        await assert.rejects(s.run({}, {}), /ATTEMPT_ALREADY_STARTED/);
      } finally {
        input.destroy();
        output.destroy();
        await t.close();
      }
    },
  );

test("proposed five-advance timeline uses four scoped invoices; explicit approval is required", async () => {
  const t = await fixture("normal", {
    limit: 5,
    explicit: true,
    reference: "SYNTHETIC_TEST_APPROVAL_ONLY",
  });
  try {
    await t.ops.inspect(await t.ops.observe());
    await t.ops.prepare({
      c: "synthetic-password-C",
      d: "synthetic-password-D",
    });
    const add = async (n) => {
      const sid = "sub_http" + n,
        id = "cs_test_http" + n;
      t.objects[sid] = {
        id: sid,
        customer: "cus_http",
        livemode: false,
        status: "active",
        default_payment_method: "pm_good",
        metadata: { user_id: t.m.c.id },
        items: { data: [{ price: { id: t.m.price } }] },
      };
      t.objects[id] = {
        id,
        subscription: sid,
        status: "complete",
        payment_status: "paid",
        customer: "cus_http",
        mode: "subscription",
        amount_total: 980,
        currency: "jpy",
        livemode: false,
        metadata: { user_id: t.m.c.id },
      };
      await t.ops.bindCheckout(id);
      return sid;
    };
    const invoice = (n, sid, status) => ({
      id: "in_http" + n,
      customer: "cus_http",
      livemode: false,
      currency: "jpy",
      total: 980,
      attempt_count: 1,
      status,
      parent: { subscription_details: { subscription: sid } },
    });
    const one = await add(1);
    t.objects.invoices = [invoice(1, one, "paid")];
    await t.ops.inspectSubscription(one);
    const times = [
      30 * 86400,
      30 * 86400 + 3600,
      60 * 86400,
      60 * 86400 + 3600,
      90 * 86400,
    ];
    await t.ops.advanceClock(t.m.frozenTime + times[0]);
    t.objects.invoices.push(invoice(2, one, "draft"));
    await t.ops.inspectSubscription(one);
    await t.ops.advanceClock(t.m.frozenTime + times[1]);
    t.objects.invoices[1].status = "paid";
    await t.ops.paymentMethod(one, true);
    await t.ops.advanceClock(t.m.frozenTime + times[2]);
    t.objects.invoices.push(invoice(3, one, "draft"));
    await t.ops.advanceClock(t.m.frozenTime + times[3]);
    t.objects.invoices[2].status = "open";
    await t.ops.inspectSubscription(one);
    await t.ops.paymentMethod(one, false);
    await t.ops.endSubscription(one);
    const two = await add(2);
    t.objects.invoices.push(invoice(4, two, "paid"));
    await t.ops.inspectSubscription(two);
    await t.ops.advanceClock(t.m.frozenTime + times[4]);
    t.objects[two].status = "canceled";
    await assert.rejects(
      t.ops.advanceClock(t.m.frozenTime + times[4] + 1),
      /OPERATION_LIMIT/,
    );
    assert.equal(
      t.calls.filter((c) => c.p.endsWith("/advance") && c.method === "POST")
        .length,
      5,
    );
    const advances = t.calls.filter(
      (c) => c.p.endsWith("/advance") && c.method === "POST",
    );
    assert(advances.every((c) => typeof c.idempotency === "string"));
    assert.equal(new Set(advances.map((c) => c.idempotency)).size, 5);
    assert((await t.ops.cleanup()).complete);
    assert((await t.ops.inspectAfter()).protectedUnchanged);
  } finally {
    await t.close();
  }
});

test("provider entry rejects the wrong CLI before any request and erases private input", async () => {
  const { createProviderRun } = await import("./provider-entry.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-entry-"));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, "input.json"),
    binary = path.join(root, "synthetic-cli");
  fs.writeFileSync(binary, "not a real executable");
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...secrets,
      cPassword: "synthetic-password-C",
      dPassword: "synthetic-password-D",
      vaultKey: randomBytes(32).toString("base64"),
    }),
    { mode: 0o600 },
  );
  const input = new PassThrough();
  input.isTTY = true;
  try {
    assert.throws(
      () =>
        createProviderRun({
          file,
          root,
          evidenceDirectory: root,
          m: { apiVersion: API_VERSION },
          cli: { binary, checksum: "0".repeat(64) },
          input,
        }),
      /CLI_HASH_MISMATCH/,
    );
    assert(!fs.existsSync(file));
  } finally {
    input.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
