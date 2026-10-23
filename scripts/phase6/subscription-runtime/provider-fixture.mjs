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
import { API_VERSION } from "./listener.mjs";
import { TARGET } from "./policy.mjs";
const secrets = {
  app: "rk_test_syntheticApp",
  listener: "rk_test_syntheticListener",
  lifecycle: "rk_test_syntheticLifecycle",
  service: "syntheticService",
  anon: "syntheticAnon",
};
export async function fixture(
  mode,
  clockApproval,
  minimal = false,
  resume = false,
) {
  const db = await isolatedSubscription(),
    pg = db.pg;
  await pg.exec("update price_versions set active=false");
  const m = {
    ...db.m,
    apiVersion: API_VERSION,
    c: { ...db.m.c, id: randomUUID() },
    d: { ...db.m.d, id: randomUUID() },
    frozenTime: 1800000000,
    ...(minimal
      ? {
          scenario: "minimal-plus-v1",
          stripePriceInitiallyActive: true,
          clock: null,
        }
      : {}),
    ...(mode === "catalog-active" ? { stripePriceInitiallyActive: true } : {}),
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
        active: minimal || mode === "catalog-active",
        livemode: false,
        unit_amount: 980,
        currency: "jpy",
        recurring: { interval: "month", interval_count: 1 },
      },
    };
  const authUsers = new Map(),
    passwords = new Map();
  if (resume) {
    assert(minimal);
    m.resume = {
      sourceAttemptId: randomUUID(),
      customer: "cus_http",
      portal: "bpc_http",
      approval: {
        resetDedicatedPasswords: true,
        reactivateRetainedPortal: true,
        reference: "synthetic-approval",
      },
    };
    for (const user of [m.c, m.d]) {
      await pg.query(
        "insert into auth.users(id,email_confirmed_at) values($1,now())",
        [user.id],
      );
      authUsers.set(user.id, {
        id: user.id,
        email: user.email,
        email_confirmed_at: new Date().toISOString(),
        app_metadata: { integration_run: m.run },
      });
      passwords.set(user.email, "synthetic-erased-old-password");
    }
    objects.customer = {
      id: "cus_http",
      test_clock: null,
      livemode: false,
      metadata: { run: m.run, user_id: m.c.id },
    };
    objects.portal = {
      id: "bpc_http",
      active: false,
      livemode: false,
      metadata: { run: m.run },
      default_return_url: m.app + "/account",
      features: {
        invoice_history: { enabled: true },
        subscription_update: { enabled: false },
        customer_update: { enabled: false },
        subscription_cancel: { enabled: false },
        payment_method_update: { enabled: false },
      },
    };
    await pg.query(
      "insert into billing_customers(user_id,stripe_customer_id,is_test) values($1,'cus_http',true)",
      [m.c.id],
    );
  }
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
      ...(method !== "GET" && p.startsWith("/v1/")
        ? { form: Object.fromEntries(f) }
        : {}),
      idempotency: req.headers["idempotency-key"],
    });
    const send = (data, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      if (resume && p === "/auth/v1/token")
        assert.equal(b.password, passwords.get(b.email));
      if (p.startsWith("/auth/v1/admin/users/")) {
        const user = authUsers.get(p.split("/").at(-1));
        assert(user);
        if (method === "PUT") {
          assert.deepEqual(Object.keys(b), ["password"]);
          passwords.set(user.email, b.password);
          if (mode === "resume-password-unknown") {
            req.socket.destroy();
            return;
          }
        } else assert.equal(method, "GET");
        return send(user);
      }
      if (
        ["connected", "browser"].includes(mode) &&
        (p === "/auth/v1/token" ||
          p === "/auth/v1/user" ||
          p.startsWith("/rest/v1/rpc/") ||
          (p.startsWith("/rest/v1/") &&
            (mode === "browser" ||
              req.headers.authorization !== "Bearer " + secrets.service)))
      ) {
        db.m.c = m.c;
        db.m.d = m.d;
        if (u.searchParams.get("order") === "id")
          u.searchParams.set("order", "id.asc");
        const output = await db.transport({
          url: TARGET.supabase + u.pathname + u.search,
          method,
          body: text || undefined,
          headers: {
            apikey:
              req.headers.apikey === secrets.service
                ? "local-service"
                : "local-anon",
            authorization: req.headers.authorization,
            accept: req.headers.accept,
          },
        });
        return send(JSON.parse(output.text), output.status);
      }
      if (p === "/v1/account")
        return send({
          id: mode === "wrong-account" ? "acct_wrong" : TARGET.account,
        });
      if (minimal)
        assert(!p.includes("test_clocks") && !p.includes("payment_methods"));
      if (p === "/v1/prices/" + m.price) return send(objects.price);
      if (p === "/v1/customers/cus_http") return send(objects.customer);
      if (p === "/v1/subscriptions")
        return send({
          has_more: false,
          data: Object.entries(objects)
            .filter(([id]) => id.startsWith("sub_"))
            .map(([, s]) => s),
        });
      if (p === "/v1/checkout/sessions" && method === "POST") {
        assert.equal(f.get("customer"), "cus_http");
        assert.equal(f.get("line_items[0][price]"), m.price);
        return send(await objects.onCheckout());
      }
      if (p === "/auth/v1/admin/users") {
        assert.equal(b.email_confirm, true);
        assert(!m.protectedUsers.includes(b.id));
        await pg.query(
          "insert into auth.users(id,email_confirmed_at) values($1,now())",
          [b.id],
        );
        // Hosted Auth does not create application profiles. Minimal runs must
        // exercise the application's login RPC before expecting a profile.
        if (!minimal)
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
        if (method === "POST") {
          objects.clock.frozen_time = Number(f.get("frozen_time"));
          await objects.onAdvance?.(objects.clock.frozen_time);
        }
        return send(objects.clock);
      }
      if (p === "/v1/billing_portal/sessions") {
        assert.equal(req.headers.authorization, "Bearer " + secrets.lifecycle);
        return send({
          customer: f.get("customer"),
          configuration: f.get("configuration"),
          return_url: f.get("return_url"),
          url:
            "https://billing.stripe.com/synthetic/" +
            (objects.portalSessions = (objects.portalSessions ?? 0) + 1),
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
          default_return_url: f.get("default_return_url"),
          features: {
            subscription_update: { enabled: false },
            customer_update: { enabled: false },
            subscription_cancel: minimal
              ? { enabled: false }
              : { enabled: true, mode: "at_period_end" },
            invoice_history: { enabled: true },
            payment_method_update: { enabled: !minimal },
          },
        };
        return send(objects.portal);
      }
      if (p === "/v1/billing_portal/configurations/bpc_http") {
        if (method === "POST") {
          if (mode === "cleanup-fail" && f.get("active") === "false")
            return send({ error: { message: "do not log" } }, 500);
          assert.deepEqual([...f.keys()], ["active"]);
          assert(["true", "false"].includes(f.get("active")));
          objects.portal.active = f.get("active") === "true";
          if (mode === "resume-portal-unknown" && objects.portal.active) {
            req.socket.destroy();
            return;
          }
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
      if (p === "/v1/invoices") {
        assert.equal(req.headers.authorization, "Bearer " + secrets.app);
        return send({
          has_more: false,
          data: (objects.invoices ?? []).filter((i) =>
            u.searchParams.has("customer")
              ? i.customer === u.searchParams.get("customer")
              : i.parent.subscription_details.subscription ===
                u.searchParams.get("subscription"),
          ),
        });
      }
      if (p.startsWith("/v1/subscriptions/")) {
        const sub = objects[p.split("/").at(-1)];
        assert(sub);
        if (method === "POST")
          sub.default_payment_method = f.get("default_payment_method");
        if (method === "DELETE") {
          assert.equal(f.get("prorate"), "false");
          assert.equal(f.get("invoice_now"), "false");
          sub.status = "canceled";
          for (const invoice of objects.invoices ?? [])
            if (invoice.parent.subscription_details.subscription === sub.id) {
              invoice.auto_advance = false;
              invoice.next_payment_attempt = null;
            }
          await objects.onCancel?.(sub);
          if (objects.dropCancelResponse) {
            req.socket.destroy();
            return;
          }
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
    minimal,
    passwordResetUsers: resume ? [m.c.id, m.d.id] : [],
    record: (x) => records.push(x),
    timeoutMs: mode === "timeout" ? 100 : mode === "browser" ? 15000 : 1000,
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
        assert(!minimal, "minimal catalog writes forbidden");
        if (mode === "catalog-active")
          assert.equal(
            active,
            false,
            "already-active catalog must not be re-enabled",
          );
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
    authUsers,
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

// Synthetic counterpart of the retained attempt files, passed to the real planner.
export async function retainedRecords(t) {
  const after = await t.ops.observe();
  const profiles = {};
  for (const label of ["c", "d"])
    profiles[label] = (
      await t.pg.query("select * from profiles where user_id=$1", [
        t.m[label].id,
      ])
    ).rows;
  return {
    priorPlan: {
      attemptId: t.m.resume.sourceAttemptId,
      manifest: structuredClone(t.m),
      expected: structuredClone(after),
      clockApproval: null,
    },
    retained: {
      sourceAttemptId: t.m.resume.sourceAttemptId,
      account: t.m.account,
      project: t.m.project,
      c: { ...t.m.c, profileCount: profiles.c.length, profiles: profiles.c },
      d: { ...t.m.d, profileCount: profiles.d.length, profiles: profiles.d },
      customer: t.m.resume.customer,
      portal: t.m.resume.portal,
      portalActive: false,
      customerBinding: "retained",
      dbPriceActive: false,
      stripePriceActive: true,
      checkoutCount: t.m.resume.history ? 1 : 0,
      subscriptionCount: t.m.resume.history ? 1 : 0,
      paymentCount: t.m.resume.history ? 1 : 0,
      ...(t.m.resume.history
        ? { history: structuredClone(t.m.resume.history) }
        : {}),
      passwords: "erased_not_recoverable",
    },
    closure: {
      completion: { closure: { complete: true } },
      revocation: {
        apiComplete: true,
        api: { listener: "revoked", app: "revoked", lifecycle: "revoked" },
      },
      temporaryFiles: Object.fromEntries(
        [
          "base-credentials.json",
          "stripe-keys.json",
          "credentials.json",
          "plan.json",
        ].map((k) => [k, "absent"]),
      ),
    },
    after,
    approval: structuredClone(t.m.resume.approval),
  };
}

export async function seedPaidHistory(t) {
  const endedAt = Math.floor(Date.now() / 1000) - 3600;
  const h = {
    checkout: "cs_test_history",
    subscription: "sub_history",
    invoice: "in_history",
    endedAt,
  };
  t.m.resume.history = h;
  t.m.resume.approval.recontractOnce = true;
  const period = { start: endedAt - 100, end: endedAt + 86400 * 30 };
  t.objects.sub_history = {
    id: h.subscription,
    customer: "cus_http",
    livemode: false,
    status: "canceled",
    ended_at: endedAt,
    canceled_at: endedAt,
    created: period.start,
    latest_invoice: h.invoice,
    metadata: { user_id: t.m.c.id },
    cancel_at_period_end: false,
    items: {
      data: [
        {
          quantity: 1,
          price: { ...t.objects.price },
          current_period_start: period.start,
          current_period_end: period.end,
        },
      ],
    },
  };
  t.objects.invoices = [
    {
      id: h.invoice,
      customer: "cus_http",
      livemode: false,
      parent: { subscription_details: { subscription: h.subscription } },
      status: "paid",
      currency: "jpy",
      amount_paid: 980,
      amount_remaining: 0,
      total: 980,
      attempt_count: 1,
      auto_advance: false,
      next_payment_attempt: null,
      created: period.start,
      status_transitions: { paid_at: period.start },
      start: period.start,
      end: period.end,
      lines: {
        has_more: false,
        data: [
          {
            quantity: 1,
            period,
            pricing: { price_details: { price: t.m.price } },
          },
        ],
      },
    },
  ];
  t.objects.cs_test_history = {
    id: h.checkout,
    subscription: h.subscription,
    customer: "cus_http",
    livemode: false,
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    amount_total: 980,
    currency: "jpy",
    metadata: { user_id: t.m.c.id },
  };
  await t.pg.query(
    "update billing_customers set checkout_session_id=$1 where user_id=$2",
    [h.checkout, t.m.c.id],
  );
  return h;
}
