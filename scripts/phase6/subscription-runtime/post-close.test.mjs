import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fixture, seedPaidHistory } from "./provider-fixture.mjs";
import { PostClosePolicy, portalObservation } from "./post-close-policy.mjs";
import { TARGET } from "./policy.mjs";
import { startRuntime } from "./runtime.mjs";
import { connectedBrowser } from "./connected-browser.mjs";
import { sessionEvidence } from "./evidence.mjs";
import { appTransport } from "./app-transport.mjs";
import { workLogin } from "./work-login.mjs";

async function prepared(mode = "connected") {
  const t = await fixture(mode, undefined, true, true);
  await seedPaidHistory(t);
  t.m.customer = "cus_http";
  t.m.portal = "bpc_http";
  const s = structuredClone(t.objects.sub_history);
  s.id = "sub_postclose";
  s.latest_invoice = "in_postclose";
  s.ended_at += 100;
  s.canceled_at = s.ended_at;
  s.created += 100;
  t.objects[s.id] = s;
  const i = structuredClone(t.objects.invoices[0]);
  i.id = s.latest_invoice;
  i.parent.subscription_details.subscription = s.id;
  t.objects.invoices.push(i);
  t.m.postClose = { subscription: s.id, invoice: i.id, endedAt: s.ended_at };
  return t;
}
test("post-close policy permits exactly one read-only Portal session and denies purchase/contract writes", async () => {
  const t = await prepared();
  try {
    const p = new PostClosePolicy(t.m);
    const request = (path, method = "POST", body = "") => ({
      url: TARGET.stripe + path,
      method,
      body,
    });
    for (const [path, method] of [
      ["/v1/checkout/sessions", "POST"],
      ["/v1/subscriptions/sub_postclose", "DELETE"],
      ["/v1/subscriptions/sub_postclose", "POST"],
      ["/v1/customers", "POST"],
      ["/v1/test_helpers/test_clocks", "GET"],
    ])
      assert.throws(() => p.authorize(request(path, method)));
    const body = new URLSearchParams({
      customer: t.m.customer,
      configuration: t.m.portal,
      return_url: TARGET.app + "/account",
    }).toString();
    assert.equal(
      p.authorize(request("/v1/billing_portal/sessions", "POST", body)).kind,
      "portal",
    );
    assert.throws(() =>
      p.authorize(request("/v1/billing_portal/sessions", "POST", body)),
    );
    assert.throws(() =>
      p.accept({ kind: "subscription" }, 200, {
        ...t.objects.sub_postclose,
        status: "active",
      }),
    );
    assert.throws(() =>
      p.accept({ kind: "subscription" }, 200, {
        ...t.objects.sub_postclose,
        id: "sub_other",
      }),
    );
    p.accept({ kind: "subscriptions" }, 200, {
      has_more: false,
      data: [t.objects.sub_history, t.objects.sub_postclose],
    });
  } finally {
    await t.close();
  }
});
test("Portal observation returns only booleans; secret address, href and text cannot leave the page", () => {
  const secret = "SYNTHETIC_TEMPORARY_ACCESS_SECRET";
  const result = vm.runInNewContext(
    "(" + portalObservation.toString() + ")()",
    {
      location: {
        origin: "https://billing.stripe.com",
        pathname: "/p/session",
        href: "https://billing.stripe.com/p/session?secret=" + secret,
      },
      document: {
        querySelectorAll: () => [
          {
            getAttribute: () => "/invoice?secret=" + secret,
            textContent: secret,
          },
          {
            getAttribute: () => TARGET.app + "/account",
            textContent: "よりそい に戻る " + secret,
          },
        ],
      },
    },
  );
  assert.equal(
    JSON.stringify(result),
    '\u007b"portal":true,"returnLink":true}',
  );
});
test(
  "post-close actual application: stale active DB -> read reconciliation -> Free, one Portal return, C/D/anonymous RLS, no purchase",
  { skip: process.env.PLUS_CONNECTED_BROWSER !== "1" },
  async () => {
    const t = await prepared("browser");
    let runtime, browser;
    const events = [];
    const m = t.m,
      o = t.objects;
    try {
      for (const [s, stale] of [
        [o.sub_history, false],
        [o.sub_postclose, true],
      ]) {
        const item = s.items.data[0];
        await t.pg.query(
          `insert into subscriptions(id,user_id,stripe_customer_id,price_version,amount,status,period_start,period_end,paid_through,cancel_at_period_end,is_test,created_at,ended_at) values($1,$2,$3,$4,980,$5,to_timestamp($6),to_timestamp($7),to_timestamp($7),false,true,to_timestamp($8),to_timestamp($9))`,
          [
            s.id,
            m.c.id,
            m.customer,
            m.version,
            stale ? "active" : "canceled",
            item.current_period_start,
            item.current_period_end,
            s.created,
            stale ? null : s.ended_at,
          ],
        );
        const i = o.invoices.find(
          (i) => i.parent.subscription_details.subscription === s.id,
        );
        await t.pg.query(
          `insert into subscription_invoices(id,subscription_id,user_id,amount,status,currency,period_start,period_end,is_test,created_at) values($1,$2,$3,980,'paid','jpy',to_timestamp($4),to_timestamp($5),true,now())`,
          [i.id, s.id, m.c.id, i.start, i.end],
        );
      }
      const passwords = { c: "SyntheticOnly123!", d: "SyntheticOnly123!" };
      for (const role of ["c", "d"])
        await t.wire({
          provider: "supabase",
          role: "service",
          method: "PUT",
          path: "/auth/v1/admin/users/" + m[role].id,
          body: { password: passwords[role] },
          operation: "reset_retained_password",
        });
      const evidence = sessionEvidence({ m, wire: t.wire, save: t.store.save });
      const login = workLogin(m, passwords);
      const transport = appTransport({
        wire: t.wire,
        login,
        operations: {
          state: () => ({ stopped: false }),
          runtimeFailed: () => {
            throw Error("synthetic_transport_failed");
          },
        },
      });
      runtime = await startRuntime({ m, transport, evidence, authOnly: true });
      browser = await connectedBrowser({
        runtime,
        m,
        pay: () => assert.fail("purchase forbidden"),
        cancel: () => assert.fail("cancel forbidden"),
      });
      await browser.checkpoint({ checkpoint: "logins" });
      await evidence.logins();
      const state = runtime.browserState;
      await runtime.stop({ continueAuthenticated: true });
      o.portal.active = true;
      await t.pg.query(
        "update service_settings set portal_configuration_id=$1",
        [m.portal],
      );
      runtime = await startRuntime({
        m,
        transport,
        evidence,
        browserState: state,
        webhookSecret: "whsec_SyntheticNoListener",
      });
      browser.attachRuntime(runtime);
      await browser.checkpoint({ checkpoint: "post-close-free-and-return" });
      await evidence.rls(1, 1);
      const rows = (
        await t.pg.query(
          "select status,ended_at from subscriptions where user_id=$1",
          [m.c.id],
        )
      ).rows;
      assert.equal(rows.length, 2);
      assert(rows.every((s) => s.status === "canceled" && s.ended_at));
      assert.equal(o.portalSessions, 1);
      assert.equal(
        t.calls.filter((c) => c.p?.includes("checkout") && c.method === "POST")
          .length,
        0,
      );
      assert.equal(
        (
          await t.pg.query("select active from price_versions where id=$1", [
            m.version,
          ])
        ).rows[0].active,
        false,
      );
      await runtime.stop();
      assert(!runtime.alive());
      o.portal.active = false;
      await t.pg.query(
        "update service_settings set portal_configuration_id=$1",
        [null],
      );
    } catch (error) {
      console.log(
        "SYNTHETIC_DIAGNOSTICS",
        events.slice(-12),
        t.records.slice(-6),
      );
      throw error;
    } finally {
      await browser?.close();
      await runtime?.stop();
      await t.close();
    }
  },
);
