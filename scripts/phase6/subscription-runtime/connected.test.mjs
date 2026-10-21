import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import Stripe from "stripe";
import { fixture } from "./provider-fixture.mjs";
import { supervisor } from "./supervisor.mjs";
import { scenario, STEPS } from "./scenario.mjs";
import { sessionEvidence } from "./evidence.mjs";
import { billingSettings, ORIGINAL_BILLING } from "./billing-settings.mjs";
import { startBroker } from "../payment-runtime/broker.mjs";
import { startRuntime } from "./runtime.mjs";
import { connectedBrowser } from "./connected-browser.mjs";
const macBrowser = process.env.PLUS_CONNECTED_BROWSER === "1";
const realTTY = process.env.PLUS_CONNECTED_TTY === "1";
import { TARGET } from "./policy.mjs";
import { receiverSession, SECRET_WINDOW_MS } from "./receiver-session.mjs";
import { assembleHandoff } from "./private-handoff.mjs";

// Actual HTTP sender + encrypted journal + migrated PostgreSQL/RLS + signed local
// broker + production scenario/supervisor. Auth, Stripe engine and UI are substitutes.
for (const mode of [
  "normal",
  "browser-failure",
  "input-disconnect",
  "unsafe-invoice",
]) {
  test("connected scenario to closure: " + mode, async () => {
    if (realTTY)
      assert(process.stdin.isTTY, "use --test-isolation=none with a real TTY");
    const t = await fixture(macBrowser ? "browser" : "connected", {
      limit: 5,
      explicit: true,
      reference: "synthetic-approval",
    });
    const { m, objects: o } = t;
    m.frozenTime = Math.floor(Date.now() / 1000) - 10;
    m.portalOnlyCancellation = true;
    const input = realTTY ? process.stdin : new PassThrough(),
      output = realTTY ? process.stdout : new PassThrough();
    if (!realTTY) input.isTTY = true;
    else assert(input.isTTY);
    const evidence = sessionEvidence({ m, wire: t.wire, save: t.store.save });
    let broker,
      browser,
      realRuntime,
      active = false,
      listenerLive = true,
      eventNo = 0,
      advances = 0,
      screenCount = 0;
    let settings = { ...ORIGINAL_BILLING };
    const settingWrites = [];
    const billing = billingSettings({
      read: async () => ({
        account: TARGET.account,
        livemode: false,
        source: "api",
        observedAt: Date.now(),
        settings: { ...settings },
        unrelatedContracts: 0,
        uncollectedInvoices: 0,
        automationsActive: false,
      }),
      write: async (x) => {
        settingWrites.push(x);
        settings[x.field] = x.value;
      },
      save: t.store.save,
    });
    const secret = "whsec_syntheticOnly";
    const policy = {
      events: new Map(),
      stopped: false,
      signedEvent(e) {
        const prior = this.events.get(e.id)?.count ?? 0;
        assert(prior < 3);
        this.events.set(e.id, { count: prior + 1 });
      },
    };
    const iso = (x) => new Date(x * 1000).toISOString();
    const snapshot = async (s) => {
      const item = s.items.data[0],
        invoices = o.invoices.filter(
          (i) => i.parent.subscription_details.subscription === s.id,
        );
      const paid = invoices.filter((i) => i.status === "paid").at(-1);
      await t.pg.query(
        `insert into subscriptions(id,user_id,stripe_customer_id,price_version,amount,status,period_start,period_end,paid_through,cancel_at_period_end,is_test,created_at,ended_at)
        values($1,$2,$3,$4,980,$5,$6,$7,$8,$9,true,now(),$10) on conflict(id) do update set status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,paid_through=excluded.paid_through,cancel_at_period_end=excluded.cancel_at_period_end,ended_at=excluded.ended_at`,
        [
          s.id,
          m.c.id,
          "cus_http",
          m.version,
          s.status,
          iso(item.current_period_start),
          iso(item.current_period_end),
          paid ? iso(paid.end) : null,
          !!s.cancel_at_period_end,
          s.status === "canceled" ? iso(o.clock.frozen_time) : null,
        ],
      );
      for (const i of invoices)
        await t.pg.query(
          `insert into subscription_invoices(id,subscription_id,user_id,amount,status,currency,period_start,period_end,is_test,created_at) values($1,$2,$3,$4,$5,'jpy',$6,$7,true,now()) on conflict(id) do update set amount=excluded.amount,status=excluded.status`,
          [
            i.id,
            s.id,
            m.c.id,
            i.status === "paid" ? 980 : 0,
            i.status,
            iso(i.start),
            iso(i.end),
          ],
        );
    };
    const send = async (type, object) => {
      const raw = JSON.stringify({
        id: "evt_connected_" + ++eventNo,
        type,
        livemode: false,
        account: TARGET.account,
        data: { object },
      });
      const r = await fetch(TARGET.broker + "/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": Stripe.webhooks.generateTestHeaderString({
            payload: raw,
            secret,
          }),
        },
        body: raw,
      });
      assert.equal(r.status, 200);
    };
    const invoice = (s, status) => {
      o.invoices ??= [];
      const item = s.items.data[0],
        i = {
          id: "in_connected_" + (o.invoices.length + 1),
          customer: "cus_http",
          livemode: false,
          currency: "jpy",
          total: 980,
          amount_paid: status === "paid" ? 980 : 0,
          created: o.clock.frozen_time,
          period_start: item.current_period_start,
          period_end: item.current_period_end,
          status_transitions: {
            paid_at: status === "paid" ? o.clock.frozen_time : null,
          },
          lines: {
            has_more: false,
            data: [
              {
                quantity: 1,
                pricing: { price_details: { price: m.price } },
                period: {
                  start: item.current_period_start,
                  end: item.current_period_end,
                },
              },
            ],
          },
          status,
          attempt_count: status === "draft" ? 0 : 1,
          auto_advance: status !== "paid",
          next_payment_attempt: null,
          start: item.current_period_start,
          end: item.current_period_end,
          parent: { subscription_details: { subscription: s.id } },
        };
      o.invoices.push(i);
      s.latest_invoice = i.id;
      return i;
    };
    const newCheckout = async (n, ops, paid) => {
      const id = "cs_test_connected_" + n;
      if (!o[id])
        o[id] = {
          id,
          url: TARGET.app + "/__subscription/checkout/" + n,
          status: "open",
          subscription: null,
          payment_status: "unpaid",
          customer: "cus_http",
          mode: "subscription",
          amount_total: 980,
          currency: "jpy",
          livemode: false,
          metadata: { user_id: m.c.id },
        };
      if (paid) {
        const s = {
          id: "sub_connected_" + n,
          customer: "cus_http",
          livemode: false,
          status: "active",
          created: o.clock.frozen_time,
          default_payment_method: "pm_good",
          cancel_at_period_end: false,
          metadata: { user_id: m.c.id },
          items: {
            data: [
              {
                price: { ...o.price },
                quantity: 1,
                current_period_start: o.clock.frozen_time,
                current_period_end: o.clock.frozen_time + 30 * 86400,
              },
            ],
          },
        };
        o[s.id] = s;
        invoice(s, "paid");
        Object.assign(o[id], {
          status: "complete",
          payment_status: "paid",
          subscription: s.id,
        });
        await send("checkout.session.completed", o[id]);
        await send("customer.subscription.created", s);
      }
      if (ops) await ops.bindCheckout(id);
      return o[id];
    };
    o.onCancel = async (s) => {
      if (active) await send("customer.subscription.deleted", s);
    };
    o.onAdvance = async () => {
      advances++;
      const s = o[advances === 5 ? "sub_connected_2" : "sub_connected_1"];
      if (advances === 5) {
        s.status = "canceled";
        await send("customer.subscription.deleted", s);
        return;
      }
      if (advances % 2) {
        const item = s.items.data[0];
        item.current_period_start = o.clock.frozen_time;
        item.current_period_end = o.clock.frozen_time + 30 * 86400;
        invoice(s, "draft");
      } else {
        const i = o.invoices.at(-1);
        i.status = advances === 2 ? "paid" : "open";
        i.attempt_count = 1;
        i.amount_paid = advances === 2 ? 980 : 0;
        i.status_transitions.paid_at =
          advances === 2 ? o.clock.frozen_time : null;
        s.status = advances === 2 ? "active" : "past_due";
        await send(
          advances === 2 ? "invoice.paid" : "invoice.payment_failed",
          i,
        );
      }
    };
    o.onCheckout = async () =>
      newCheckout(
        Object.keys(o).filter((k) => k.startsWith("cs_test_")).length + 1,
        null,
        false,
      );
    let run;
    const executeCore = scenario({
      wire: t.wire,
      evidence,
      save: t.store.save,
      operator: {
        request: async (kind, data) => {
          assert.equal(kind, "browser");
          screenCount++;
          if (
            mode === "browser-failure" &&
            data.checkpoint === "pay-second-once"
          )
            throw Error("synthetic");
          if (
            mode === "input-disconnect" &&
            data.checkpoint === "pay-second-once"
          ) {
            input.end();
            return new Promise(() => {});
          }
          if (macBrowser) {
            const result = await browser.checkpoint(data);
            if (
              mode === "unsafe-invoice" &&
              data.checkpoint === "account-and-denials"
            )
              o.invoices.find((i) => i.status === "open").auto_advance = true;
            return result;
          }
          if (data.checkpoint === "logins")
            for (const u of [m.c, m.d]) {
              const login = await t.wire({
                provider: "supabase",
                role: "anon",
                method: "POST",
                path: "/auth/v1/token?grant_type=password",
                body: { email: u.email, password: "SyntheticOnly123!" },
                operation: "synthetic_login",
              });
              evidence.accepted({ kind: "login", user: u.id }, login);
            }
          if (data.checkpoint === "checkout-first-display")
            await newCheckout(1, run.operations, false);
          if (data.checkpoint === "pay-first-once")
            await newCheckout(1, run.operations, true);
          if (data.checkpoint === "pay-second-once")
            await newCheckout(2, run.operations, true);
          if (data.checkpoint === "portal-second-cancel-once-return") {
            run.operations.reserveRuntime("portal", 2);
            o.sub_connected_2.cancel_at_period_end = true;
            await send("customer.subscription.updated", o.sub_connected_2);
          }
          if (
            mode === "unsafe-invoice" &&
            data.checkpoint === "account-and-denials"
          )
            o.invoices.find((i) => i.status === "open").auto_advance = true;
          return { checkpoint: data.checkpoint, observed: true };
        },
      },
    });
    const execute = Object.assign(
      async (...args) => {
        const result = await executeCore(...args);
        if (realTTY && args[0] === "next") completed++;
        return result;
      },
      { commands: executeCore.commands },
    );
    let receptionTime = Date.now();
    const receiver = await receiverSession({
      directory: t.root,
      now: () => receptionTime,
    });
    let file;
    try {
      receptionTime += 7 * 24 * 60 * 60 * 1000;
      assert.equal(
        (await receiver.beforeCreate()).remainingMs,
        SECRET_WINDOW_MS,
      );
      const form = await (await fetch(receiver.url)).text();
      const csrf = form.match(/name="csrf" value="([^"]+)"/)[1];
      fs.writeFileSync(
        path.join(t.root, "base-credentials.json"),
        JSON.stringify({
          anon: "synthetic",
          service: "synthetic",
          cPassword: "synthetic-password-C",
          dPassword: "synthetic-password-D",
          vaultKey: Buffer.alloc(32, 1).toString("base64"),
        }),
        { mode: 0o600 },
      );
      const submitted = await fetch(receiver.url, {
        method: "POST",
        headers: { Origin: new URL(receiver.url).origin },
        body: new URLSearchParams({
          csrf,
          listener: "rk_test_" + "a".repeat(32),
          app: "rk_test_" + "b".repeat(32),
          lifecycle: "rk_test_" + "c".repeat(32),
        }),
      });
      assert.equal(submitted.status, 200);
      await submitted.body.cancel();
      await receiver.handoff();
      file = assembleHandoff(t.root);
    } finally {
      await receiver.close("test_finished");
    }
    let revoke = false;
    run = supervisor({
      m,
      attemptId: randomUUID(),
      wire: t.wire,
      save: t.store.save,
      input,
      output,
      temporary: { root: t.root, file },
      execute,
      evidence,
      billing,
      clockApproval: { limit: 5, explicit: true, reference: "synthetic-only" },
      timeoutMs: realTTY ? 20 * 60 * 1000 : macBrowser ? 180000 : 20000,
      human: {
        price: async (active) => {
          o.price.active = active;
          return true;
        },
        revokeKeys: async () => {
          revoke = true;
          return true;
        },
      },
      listener: {
        start: async () => ({
          account: TARGET.account,
          apiVersion: m.apiVersion,
          secret,
        }),
        alive: () => listenerLive,
        stop: async () => {
          listenerLive = false;
        },
      },
      runtimeFactory: async (args) => {
        active = true;
        if (macBrowser) {
          realRuntime = await startRuntime({
            ...args,
            record: (x) => {
              if (x.event === "stop" || x.event === "policy_denied")
                console.log("SYNTHETIC_RUNTIME", x);
            },
          });
          browser = await connectedBrowser({
            runtime: realRuntime,
            m,
            pay: (n) => newCheckout(n, run.operations, true),
            cancel: async () => {
              o.sub_connected_2.cancel_at_period_end = true;
              await send("customer.subscription.updated", o.sub_connected_2);
            },
          });
          return {
            ...realRuntime,
            stop: async () => {
              active = false;
              await browser.close();
              await realRuntime.stop();
            },
          };
        }
        broker = await startBroker({
          policy,
          port: 5219,
          token: "synthetic",
          webhookSecret: () => secret,
          forwardToken: "synthetic",
          transport: async () => {
            throw Error("unused");
          },
          onWebhookSuccess: (raw) => evidence.delivered(raw),
          forward: async (raw) => {
            const e = JSON.parse(raw),
              v = e.data.object;
            const id = e.type.startsWith("customer.subscription.")
              ? v.id
              : e.type.startsWith("invoice.")
                ? v.parent.subscription_details.subscription
                : v.subscription;
            await snapshot(o[id]);
            return { status: 200, text: "{}" };
          },
        });
        return {
          alive: () => active,
          secret,
          policy,
          stop: async () => {
            active = false;
            await broker.stop();
          },
        };
      },
    });
    let completed = 0;
    if (!realTTY)
      output.on("data", (chunk) => {
        const s = String(chunk);
        if (s.startsWith("ready:"))
          setImmediate(() => input.write("status\nnext\n"));
        if (s === "check completed\n") {
          completed++;
          setImmediate(() =>
            input.write(completed === STEPS.length ? "finish\n" : "next\n"),
          );
        }
      });
    try {
      const expected = await t.ops.observe();
      const result = await run.run(expected, {
        c: "synthetic-password-C",
        d: "synthetic-password-D",
      });
      assert.equal(
        result.complete,
        mode === "normal",
        JSON.stringify({
          result,
          completed,
          calls: t.calls.slice(-8),
          traces: browser?.traces().slice(-10),
        }),
      );
      assert.equal(
        result.closure.complete,
        ["normal", "browser-failure", "input-disconnect"].includes(mode),
        JSON.stringify({ result, completed }),
      );
      assert(revoke);
      assert(!active);
      assert(!fs.existsSync(file));
      assert.equal(o.price.active, false);
      assert.equal(o.portal.active, false);
      if (mode === "unsafe-invoice")
        assert.equal(
          settingWrites.filter((x) => x.phase === "restore").length,
          0,
        );
      else assert.deepEqual(settings, ORIGINAL_BILLING);
      assert(advances <= 5);
      assert.equal(await t.protectedState(), t.original);
      if (mode === "normal") {
        assert.equal(advances, 5);
        assert.equal(o.invoices.length, 4);
        assert.equal(completed, 10);
        assert(screenCount >= 6);
      }
    } finally {
      if (!realTTY) {
        input.destroy();
        output.destroy();
      } else input.pause();
      if (active) {
        active = false;
        await browser?.close();
        await realRuntime?.stop();
        await broker?.stop();
      }
      await t.close();
    }
  });
}
