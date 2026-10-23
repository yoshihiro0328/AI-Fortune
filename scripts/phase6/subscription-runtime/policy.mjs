import { createHash, createHmac } from "node:crypto";
import {
  paymentHistory,
  historicalSubscription,
  historicalInvoice,
  historicalRow,
} from "./history.mjs";
export const TARGET = Object.freeze({
  ref: "ukdzggjfkcwjssjmnqim",
  account: "acct_1UQlQdI73kTcvXz8",
  supabase: "https://ukdzggjfkcwjssjmnqim.supabase.co",
  stripe: "https://api.stripe.com",
  app: "http://localhost:5218",
  broker: "http://127.0.0.1:5219",
});
export const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];
export const check = (v, code = "SCOPE_DENIED") => {
  if (!v) throw Error(code);
};
export const sha = (v) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(v))
    .digest("hex");
export function validate(m) {
  check(
    m.project === TARGET.ref &&
      m.account === TARGET.account &&
      m.app === TARGET.app,
    "TARGET_MISMATCH",
  );
  check(m.amount === 980 && m.currency === "jpy" && m.interval === "month");
  check(
    m.c.id !== m.d.id &&
      [m.run, m.c.id, m.d.id].every((x) =>
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(x),
      ),
  );
  check(
    Array.isArray(m.protectedUsers) &&
      m.protectedUsers.length === 2 &&
      m.protectedUsers.every((x) => ![m.c.id, m.d.id].includes(x)),
  );
  for (const [k, p] of [
    ["customer", "cus_"],
    ["clock", "clock_"],
    ["price", "price_"],
    ["product", "prod_"],
    ["portal", "bpc_"],
  ])
    if (k === "clock" && m.scenario === "minimal-plus-v1")
      check(m.clock === null);
    else check(m[k]?.startsWith(p));
  check(
    m.version &&
      !m.version.includes("plus-2026-10-980") &&
      m.c.email.endsWith("@example.invalid") === m.synthetic,
  );
}
export const sessionHash = (m, value) =>
  createHmac("sha256", m.sessionSecret).update(value).digest("hex");
const ownTables = [
  "profiles",
  "diagnoses",
  "consultation_subjects",
  "consultation_threads",
  "subject_diagnoses",
  "subscriptions",
  "subscription_invoices",
  "billing_customers",
];
export class Policy {
  constructor(m, reserve = () => {}) {
    validate(m);
    this.m = m;
    this.history = paymentHistory(m);
    this.minimal = m.scenario === "minimal-plus-v1";
    this.contractLimit = this.minimal ? 1 : 2;
    this.invoiceLimit = this.minimal ? 1 : 4;
    this.reserve = reserve;
    this.stopped = false;
    this.counts = new Map();
    this.ids = new Set();
    this.invoiceIds = new Set();
    this.sessions = new Map();
    this.events = new Map();
    this.locks = new Map();
    this.journal = [];
  }
  once(key, limit = 1) {
    const n = (this.counts.get(key) || 0) + 1;
    check(n <= limit, "OPERATION_LIMIT");
    this.reserve(key, n);
    this.counts.set(key, n);
    this.journal.push({ operation: key, attempt: n, state: "reserved" });
  }
  authorize(r) {
    check(!this.stopped, "STOPPED");
    const u = new URL(r.url),
      m = this.m,
      q = u.searchParams;
    check(!u.username && !u.password && !u.hash);
    check(new Set(q.keys()).size === q.size, "DUPLICATE_QUERY");
    if (q.has("limit"))
      check(/^\d+$/.test(q.get("limit")) && Number(q.get("limit")) <= 200);
    if (q.has("offset")) check(q.get("offset") === "0");
    const json = () => JSON.parse(r.body || "{}"),
      user = (v) => [m.c.id, m.d.id].includes(v);
    if (u.origin === TARGET.supabase) {
      if (u.pathname === "/auth/v1/token") {
        check(r.method === "POST");
        const b = json();
        if (q.get("grant_type") === "password") {
          const x = [m.c, m.d].find((x) => x.email === b.email);
          check(x);
          this.once("login:" + x.id);
          return { kind: "login", user: x.id };
        }
        check(
          q.get("grant_type") === "refresh_token" &&
            this.sessions.has(b.refresh_token),
        );
        const id = this.sessions.get(b.refresh_token);
        this.once("refresh:" + id, 2);
        return { kind: "login", user: id };
      }
      if (u.pathname === "/auth/v1/user") {
        check(r.method === "GET");
        return { kind: "user" };
      }
      check(u.pathname.startsWith("/rest/v1/"));
      const t = u.pathname.slice(9);
      if (t.startsWith("rpc/")) {
        check(r.method === "POST");
        const b = json(),
          name = t.slice(4);
        if (name === "consume_limit") {
          check(Object.keys(b).sort().join(",") === "p_key,p_limit,p_seconds");
          check(
            [
              "auth:ip:" + sessionHash(m, "local"),
              ...["c", "d"].flatMap((k) => [
                "auth:login:" + sessionHash(m, m[k].cookie),
                "auth-email:login:" + sessionHash(m, m[k].email),
              ]),
            ].includes(b.p_key) ||
              ["billing-read:", "billing:"].some((x) =>
                [m.c.id, m.d.id].some((id) => b.p_key === x + id),
              ),
          );
          check(b.p_limit <= 60 && b.p_seconds <= 3600);
        } else if (name === "claim_anonymous_diagnoses") {
          check(
            user(b.p_user) &&
              [m.c, m.d].some(
                (x) =>
                  x.id === b.p_user && b.p_session === sessionHash(m, x.cookie),
              ),
          );
        } else if (name === "consultation_entitlement") {
          check(user(b.p_user) && Object.keys(b).length === 1);
        } else if (name === "acquire_lock") {
          check(
            b.p_key === "billing:" + m.c.id ||
              [...this.ids, this.history?.subscription]
                .filter(Boolean)
                .some((id) => b.p_key === "stripe-subscription:" + id),
          );
          return { kind: name, key: b.p_key, token: b.p_token };
        } else if (name === "apply_subscription_snapshot") {
          const s = b.p_snapshot;
          check(
            (this.ids.has(s.id) ||
              historicalRow("subscriptions", s, this.history, m.c.id)) &&
              s.user_id === m.c.id &&
              s.stripe_customer_id === m.customer &&
              s.amount === 980 &&
              s.is_test === true &&
              s.price_version === m.version,
          );
          if (s.id === this.history?.subscription)
            check(
              b.p_invoices.length === 1 &&
                b.p_invoices.every((i) =>
                  historicalRow(
                    "subscription_invoices",
                    i,
                    this.history,
                    m.c.id,
                  ),
                ) &&
                !b.p_event,
              "HISTORY_SNAPSHOT_MISMATCH",
            );
          check(
            b.p_invoices.length <= this.invoiceLimit &&
              b.p_invoices.every(
                (i) =>
                  i.user_id === m.c.id &&
                  i.subscription_id === s.id &&
                  i.is_test === true &&
                  i.currency === "jpy",
              ),
          );
          check(!b.p_event || this.events.has(b.p_event));
          this.once("snapshot:" + s.id, 60);
        } else check(false);
        return { kind: name };
      }
      if (r.method === "GET") {
        check(
          ownTables.includes(t) ||
            [
              "payment_environment",
              "service_settings",
              "price_versions",
            ].includes(t),
        );
        for (const k of q.keys())
          check(
            [
              "select",
              "user_id",
              "stripe_customer_id",
              "kind",
              "stripe_price_id",
              "is_test",
              "active",
              "id",
              "order",
              "limit",
              "offset",
              "nickname",
              "title",
              "anonymous_session_id",
            ].includes(k),
          );
        if (ownTables.includes(t))
          check(
            user(q.get("user_id")?.replace(/^eq\./, "")) ||
              (t === "diagnoses" &&
                q.get("user_id") === "is.null" &&
                [m.c, m.d].some(
                  (x) =>
                    q.get("anonymous_session_id") ===
                    "eq." + sessionHash(m, x.cookie),
                )) ||
              (t === "billing_customers" &&
                q.get("stripe_customer_id") === "eq." + m.customer),
          );
        if (t === "price_versions")
          check(
            q.get("kind") === "eq.plus" &&
              ((q.get("active") === "eq.true" &&
                q.get("is_test") === "eq.true") ||
                q.get("stripe_price_id") === "eq." + m.price),
          );
        return { kind: "read" };
      }
      const b = json();
      if (t === "billing_customers" && r.method === "PATCH") {
        check(
          q.get("user_id") === "eq." + m.c.id &&
            Object.keys(b).join() === "checkout_session_id" &&
            this.checkouts?.has(b.checkout_session_id),
        );
        return { kind: "binding" };
      }
      if (t === "operation_locks" && r.method === "DELETE") {
        const k = q.get("key")?.slice(3);
        check(this.locks.get(k) === q.get("token")?.slice(3));
        this.locks.delete(k);
        return { kind: "unlock" };
      }
      if (t === "analytics_events" && r.method === "POST") {
        check(
          b.user_id === m.c.id &&
            b.event_name === "plus_checkout_started" &&
            b.is_test === true &&
            b.anonymous_session_id === sessionHash(m, m.c.cookie) &&
            Object.keys(b.metadata).length === 0,
        );
        this.once("analytics", this.contractLimit);
        return { kind: "analytics" };
      }
      check(false);
    }
    check(u.origin === TARGET.stripe);
    const path = u.pathname,
      b = new URLSearchParams(r.body || "");
    if (r.method === "GET") {
      if (path === "/v1/account") return { kind: "account" };
      if (path === "/v1/prices/" + m.price) return { kind: "price" };
      if (path === "/v1/customers/" + m.customer) return { kind: "customer" };
      if (path === "/v1/billing_portal/configurations/" + m.portal)
        return { kind: "portalConfiguration" };
      if (path === "/v1/subscriptions") {
        check(
          q.get("customer") === m.customer &&
            q.get("status") === "all" &&
            ["10", "100"].includes(q.get("limit")) &&
            q.size === 3,
        );
        return { kind: "subscriptions" };
      }
      if (
        [...this.ids, this.history?.subscription]
          .filter(Boolean)
          .some((id) => path === "/v1/subscriptions/" + id)
      ) {
        check(
          q.size <= 1 && (!q.size || q.get("expand[0]") === "latest_invoice"),
        );
        return { kind: "subscription" };
      }
      if (path === "/v1/invoices") {
        check(
          (this.ids.has(q.get("subscription")) ||
            q.get("subscription") === this.history?.subscription) &&
            q.get("limit") === "24" &&
            q.size === 2,
        );
        return { kind: "invoices", subscription: q.get("subscription") };
      }
      if (
        [...(this.checkouts ?? []), this.history?.checkout]
          .filter(Boolean)
          .some((id) => path === "/v1/checkout/sessions/" + id)
      )
        return { kind: "checkoutRead" };
    }
    if (path === "/v1/checkout/sessions" && r.method === "POST") {
      check(
        b.get("customer") === m.customer &&
          b.get("mode") === "subscription" &&
          b.get("line_items[0][price]") === m.price &&
          b.get("line_items[0][quantity]") === "1" &&
          b.get("metadata[user_id]") === m.c.id &&
          b.get("subscription_data[metadata][user_id]") === m.c.id &&
          b.get("success_url") ===
            TARGET.app + "/account?subscription=complete" &&
          b.get("cancel_url") === TARGET.app + "/plans" &&
          b.get("automatic_tax[enabled]") === "false",
      );
      check(
        [...b.keys()].every((k) =>
          [
            "mode",
            "automatic_tax[enabled]",
            "custom_text[submit][message]",
            "customer",
            "line_items[0][price]",
            "line_items[0][quantity]",
            "subscription_data[metadata][app]",
            "subscription_data[metadata][user_id]",
            "subscription_data[metadata][price_version]",
            "metadata[app]",
            "metadata[user_id]",
            "metadata[kind]",
            "success_url",
            "cancel_url",
            "integration_identifier",
          ].includes(k),
        ),
      );
      this.once("checkout", this.contractLimit);
      return { kind: "checkout" };
    }
    if (path === "/v1/billing_portal/sessions" && r.method === "POST") {
      check(
        b.size === 3 &&
          b.get("customer") === m.customer &&
          b.get("configuration") === m.portal &&
          b.get("return_url") === TARGET.app + "/account",
      );
      this.once("portal", this.minimal ? 1 : 2);
      return { kind: "portal" };
    }
    if (
      r.method === "POST" &&
      [...this.ids].some((id) => path === "/v1/subscriptions/" + id)
    ) {
      check(
        !this.minimal &&
          m.synthetic === true &&
          m.portalOnlyCancellation !== true,
        "PERIOD_END_CANCEL_PORTAL_ONLY",
      );
      check(b.size === 1 && b.get("cancel_at_period_end") === "true");
      this.once("cancel:" + path, 1);
      return { kind: "subscription" };
    }
    check(false);
  }
  accept(t, status, d) {
    check(status >= 200 && status < 300, "UPSTREAM_STATUS");
    const m = this.m;
    if (t.kind === "acquire_lock" && d === true) this.locks.set(t.key, t.token);
    if (t.kind === "account") check(d.id === TARGET.account);
    if (t.kind === "login") {
      check(d.user?.id === t.user && d.user.email_confirmed_at);
      this.sessions.set(d.refresh_token, t.user);
    }
    if (t.kind === "user")
      check([m.c.id, m.d.id].includes(d.id) && d.email_confirmed_at);
    if (t.kind === "price")
      check(
        d.id === m.price &&
          d.product === m.product &&
          d.currency === "jpy" &&
          d.unit_amount === 980 &&
          d.livemode === false &&
          d.active &&
          d.recurring?.interval === "month" &&
          d.recurring.interval_count === 1,
      );
    if (t.kind === "customer")
      check(
        d.id === m.customer &&
          d.livemode === false &&
          d.test_clock === m.clock &&
          d.metadata?.run === m.run &&
          d.metadata?.user_id === m.c.id,
      );
    if (t.kind === "portalConfiguration")
      check(
        d.id === m.portal &&
          d.livemode === false &&
          d.active &&
          d.features?.subscription_update?.enabled === false &&
          d.features?.customer_update?.enabled === false &&
          (this.minimal
            ? d.features?.subscription_cancel?.enabled === false
            : d.features?.subscription_cancel?.enabled === true &&
              d.features.subscription_cancel.mode === "at_period_end") &&
          d.features?.invoice_history?.enabled === true &&
          d.features?.payment_method_update?.enabled === !this.minimal,
      );
    if (["subscription", "subscriptions"].includes(t.kind))
      for (const s of t.kind === "subscriptions" ? d.data : [d]) {
        check(
          s.customer === m.customer &&
            s.livemode === false &&
            s.metadata?.user_id === m.c.id &&
            s.items.data.length === 1 &&
            s.items.data[0].price.id === m.price,
        );
        if (s.id === this.history?.subscription)
          check(
            historicalSubscription(s, this.history),
            "HISTORICAL_SUBSCRIPTION_CHANGED",
          );
        else this.ids.add(s.id);
        check(this.ids.size <= this.contractLimit);
      }
    if (t.kind === "subscriptions") check(d.has_more === false);
    if (t.kind === "invoices") {
      if (t.subscription === this.history?.subscription)
        check(
          d.data?.length === 1 && historicalInvoice(d.data[0], this.history),
          "HISTORICAL_INVOICE_CHANGED",
        );
      check(
        !d.has_more &&
          d.data.length <= this.invoiceLimit &&
          d.data.every(
            (i) =>
              typeof i.id === "string" &&
              i.id.startsWith("in_") &&
              i.customer === m.customer &&
              i.livemode === false &&
              i.parent?.subscription_details?.subscription === t.subscription,
          ),
      );
      const observed = new Set([
        ...this.invoiceIds,
        ...d.data
          .filter((i) => i.id !== this.history?.invoice)
          .map((i) => i.id),
      ]);
      check(observed.size <= this.invoiceLimit, "INVOICE_LIMIT");
      this.invoiceIds = observed;
    }
    if (["checkout", "checkoutRead"].includes(t.kind)) {
      if (d.id === this.history?.checkout)
        check(
          t.kind === "checkoutRead" &&
            d.status === "complete" &&
            d.payment_status === "paid" &&
            d.subscription === this.history.subscription,
          "HISTORICAL_CHECKOUT_CHANGED",
        );
      check(
        d.customer === m.customer &&
          d.livemode === false &&
          d.mode === "subscription" &&
          d.amount_total === 980 &&
          d.currency === "jpy" &&
          d.metadata?.user_id === m.c.id,
      );
      if (t.kind === "checkout") {
        this.checkouts ??= new Set();
        this.checkouts.add(d.id);
      }
    }
    if (t.kind === "claim_anonymous_diagnoses")
      check(d === 0, "UNEXPECTED_CLAIM");
  }
  signed(e, raw) {
    check(
      !this.stopped &&
        EVENTS.includes(e.type) &&
        e.livemode === false &&
        (!e.account || e.account === TARGET.account),
    );
    const o = e.data.object;
    check(o.customer === this.m.customer && o.livemode === false);
    if (e.type === "checkout.session.completed")
      check(o.mode === "subscription" && this.checkouts?.has(o.id));
    if (e.type.startsWith("customer.subscription."))
      check(
        o.metadata?.user_id === this.m.c.id &&
          o.items.data[0].price.id === this.m.price,
      );
    const id = e.type.startsWith("customer.subscription.")
      ? o.id
      : e.type.startsWith("invoice.")
        ? o.parent?.subscription_details?.subscription
        : o.subscription;
    check(typeof id === "string" && id.startsWith("sub_"));
    check(id !== this.history?.subscription, "HISTORICAL_EVENT_DENIED");
    this.ids.add(id);
    check(this.ids.size <= this.contractLimit);
    const prev = this.events.get(e.id);
    check(!prev || prev.hash === sha(raw));
    const n = (prev?.count || 0) + 1;
    check(n <= 3 && this.events.size < 40);
    this.events.set(e.id, { hash: sha(raw), count: n });
  }
}
