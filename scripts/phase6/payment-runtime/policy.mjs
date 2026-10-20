// No network or credential lookup in this module. Unknown requests fail closed.
import { createHash, createHmac } from "node:crypto";
export const TARGET = Object.freeze({
  ref: "ukdzggjfkcwjssjmnqim",
  supabase: "https://ukdzggjfkcwjssjmnqim.supabase.co",
  stripe: "https://api.stripe.com",
  account: "acct_1UQlQdI73kTcvXz8",
  version: "report-integration-202610-980-v1",
  price: "price_1UQlnvI73kTcvXz8twnU8NIR",
  product: "prod_VRf89e8A94b0mb",
  app: "http://localhost:5208",
});
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export const uuid = (s) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    s ?? "",
  );
export function insist(ok, code = "POLICY_DENIED") {
  if (!ok) throw new Error(code);
}
const exact = (a, b) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort());
const keys = (o, allowed) =>
  o && !Array.isArray(o) && Object.keys(o).every((k) => allowed.includes(k));
const one = (v) => (Array.isArray(v) ? (insist(v.length === 1), v[0]) : v);
export function validateManifest(m) {
  insist(uuid(m.run) && uuid(m.diagnosis) && uuid(m.a.id) && uuid(m.b.id));
  insist(m.a.id !== m.b.id && m.a.email !== m.b.email);
  insist(
    [m.a, m.b].every(
      (x) =>
        typeof x.email === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email) &&
        /^[\w-]{43}$/.test(x.cookie),
    ),
  );
  insist(m.a.cookie !== m.b.cookie && /^[a-f0-9]{64}$/.test(m.sessionSecret));
}
export class Policy {
  constructor(m, reserve = () => {}) {
    validateManifest(m);
    this.m = m;
    this.reserve = reserve;
    this.ready = false;
    this.stopped = false;
    this.tokens = new Map();
    this.refresh = new Map();
    this.used = new Set();
    this.events = new Map();
    this.counts = new Map();
    this.flags = new Set();
    const h = (s) =>
      createHmac("sha256", m.sessionSecret).update(s).digest("hex");
    this.sessions = { [m.a.id]: h(m.a.cookie), [m.b.id]: h(m.b.cookie) };
    this.rates = new Map([
      ["auth:ip:" + h("local"), [40, 3600]],
      ["checkout:" + m.diagnosis, [15, 3600]],
      ...[m.a, m.b].flatMap((u) => [
        ["auth:login:" + h(u.cookie), [10, 3600]],
        ["auth-email:login:" + h(u.email.trim().toLowerCase()), [10, 3600]],
      ]),
    ]);
  }
  once(tag, max = 1) {
    const n = (this.counts.get(tag) ?? 0) + 1;
    insist(n <= max, "SEND_LIMIT");
    this.reserve(tag, n);
    this.counts.set(tag, n);
  }
  authorize(r) {
    insist(this.ready && !this.stopped, "NOT_READY");
    const u = new URL(r.url);
    insist(
      !u.username &&
        !u.password &&
        !u.hash &&
        !/%(?:2f|5c|00)/i.test(u.pathname),
    );
    insist(
      [TARGET.supabase, TARGET.stripe].includes(u.origin),
      "DESTINATION_DENIED",
    );
    const h = new Headers(r.headers);
    const method = r.method ?? "GET";
    insist(!["stripe-account", "stripe-context"].some((x) => h.has(x)));
    insist(
      ["accept-profile", "content-profile"].every(
        (x) => !h.has(x) || h.get(x) === "public",
      ),
    );
    insist(!h.get("prefer")?.includes("resolution="));
    const q = Object.fromEntries(u.searchParams);
    insist(Object.keys(q).length === [...u.searchParams].length);
    let b = {};
    if (r.body) {
      b =
        u.origin === TARGET.stripe
          ? Object.fromEntries(new URLSearchParams(r.body))
          : JSON.parse(r.body);
    }
    if (r.body && u.origin === TARGET.stripe)
      insist(Object.keys(b).length === [...new URLSearchParams(r.body)].length);
    const ticket = { method, path: u.pathname, q, kind: "", b };
    if (u.origin === TARGET.stripe) {
      insist(h.get("authorization") === "Bearer rk_test_local_proxy");
      if (
        method === "GET" &&
        !Object.keys(q).length &&
        u.pathname === "/v1/account"
      )
        ticket.kind = "account";
      else if (
        method === "GET" &&
        !Object.keys(q).length &&
        u.pathname === `/v1/prices/${TARGET.price}`
      )
        ticket.kind = "price";
      else if (
        method === "POST" &&
        !Object.keys(q).length &&
        u.pathname === "/v1/checkout/sessions"
      ) {
        insist(
          this.payment &&
            this.lock &&
            this.flags.has("price") &&
            this.flags.has("account"),
        );
        insist(exact(b, this.checkoutForm()));
        insist(
          h.get("idempotency-key") ===
            `checkout:sandbox:${this.payment}:initial`,
        );
        this.once("checkout");
        ticket.kind = "checkout";
      } else if (
        method === "GET" &&
        this.checkout &&
        u.pathname === `/v1/checkout/sessions/${this.checkout}` &&
        !Object.keys(q).length
      )
        ticket.kind = "session";
      else if (
        method === "GET" &&
        this.checkout &&
        u.pathname === `/v1/checkout/sessions/${this.checkout}/line_items` &&
        exact(q, { limit: "2" })
      )
        ticket.kind = "lines";
      else if (
        method === "GET" &&
        this.intent &&
        u.pathname === `/v1/payment_intents/${this.intent}` &&
        !Object.keys(q).length
      )
        ticket.kind = "intent";
      else insist(false);
    } else {
      const auth = h.get("authorization")?.replace(/^Bearer /, "");
      insist(["local-anon", "local-service"].includes(h.get("apikey")));
      if (u.pathname.startsWith("/auth/")) {
        insist(h.get("apikey") === "local-anon");
        if (
          method === "GET" &&
          u.pathname === "/auth/v1/user" &&
          !Object.keys(q).length
        ) {
          insist(this.tokens.has(hash(auth ?? "")));
          ticket.kind = "user";
          ticket.user = this.tokens.get(hash(auth));
        } else if (
          method === "POST" &&
          u.pathname === "/auth/v1/token" &&
          exact(q, { grant_type: "password" })
        ) {
          insist(
            auth === "local-anon" &&
              keys(b, ["email", "password", "gotrue_meta_security"]),
          );
          insist(!b.gotrue_meta_security || exact(b.gotrue_meta_security, {}));
          const user = [this.m.a, this.m.b].find((x) => x.email === b.email);
          insist(
            user &&
              typeof b.password === "string" &&
              b.password.length >= 12 &&
              b.password.length <= 128,
          );
          this.once("login:" + user.id);
          ticket.kind = "login";
          ticket.user = user.id;
        } else if (
          method === "POST" &&
          u.pathname === "/auth/v1/token" &&
          exact(q, { grant_type: "refresh_token" })
        ) {
          insist(
            keys(b, ["refresh_token", "gotrue_meta_security"]) &&
              (!b.gotrue_meta_security || exact(b.gotrue_meta_security, {})),
          );
          ticket.user = this.refresh.get(hash(b.refresh_token ?? ""));
          insist(ticket.user);
          this.once("refresh:" + ticket.user, 2);
          this.refresh.delete(hash(b.refresh_token));
          ticket.kind = "login";
        } else insist(false);
      } else {
        insist(h.get("apikey") === "local-service" && auth === "local-service");
        const table = u.pathname.replace("/rest/v1/", "");
        if (method === "GET") {
          // Filters are enumerated, including select. No or(), embedding, arbitrary IDs or schemas.
          const select = q.select ?? "*";
          const f = { ...q };
          delete f.select;
          const simpleSelect = /^(\*|[a-z_]+(?:,[a-z_]+)*)$/.test(select);
          insist(simpleSelect);
          let allowed = false;
          if (table === "payment_environment") allowed = exact(f, {});
          if (table === "price_versions")
            allowed =
              exact(f, { id: "eq." + TARGET.version }) ||
              exact(f, {
                kind: "eq.report",
                is_test: "eq.true",
                active: "eq.true",
              });
          if (table === "diagnoses")
            allowed =
              exact(f, { id: "eq." + this.m.diagnosis }) ||
              ([this.m.a.id, this.m.b.id].some((id) =>
                exact(f, {
                  user_id: "eq." + id,
                  order: "created_at.desc",
                  offset: "0",
                  limit: "20",
                }),
              ) &&
                select === "id,status,created_at");
          if (
            ["diagnosis_answers", "free_reports", "paid_reports"].includes(
              table,
            )
          )
            allowed = exact(f, { diagnosis_id: "eq." + this.m.diagnosis });
          if (table === "payments")
            allowed =
              exact(f, { diagnosis_id: "eq." + this.m.diagnosis }) ||
              (this.payment && exact(f, { id: "eq." + this.payment }));
          insist(allowed);
          ticket.kind = "read:" + table;
        } else if (
          method === "POST" &&
          table === "payments" &&
          exact(q, { select: "*" })
        ) {
          insist(
            this.lock &&
              exact(b, {
                diagnosis_id: this.m.diagnosis,
                user_id: this.m.a.id,
                amount: 980,
                is_test: true,
                price_version: TARGET.version,
              }),
          );
          this.once("payment");
          ticket.kind = "payment";
        } else if (
          method === "PATCH" &&
          table === "payments" &&
          this.payment &&
          exact(q, { id: "eq." + this.payment, status: "in.(pending,failed)" })
        ) {
          insist(
            this.checkout &&
              keys(b, ["stripe_checkout_session_id", "status", "updated_at"]) &&
              Object.keys(b).length === 3 &&
              b.stripe_checkout_session_id === this.checkout &&
              b.status === "pending" &&
              Number.isFinite(Date.parse(b.updated_at)),
          );
          this.once("payment-link");
          ticket.kind = "write";
        } else if (
          method === "POST" &&
          table === "analytics_events" &&
          exact(q, {})
        ) {
          insist(
            exact(b, {
              event_name: "checkout_started",
              anonymous_session_id: this.sessions[this.m.a.id],
              user_id: this.m.a.id,
              metadata: { diagnosis_id: this.m.diagnosis },
              is_test: true,
            }) && this.checkout,
          );
          this.once("analytics");
          ticket.kind = "write";
        } else if (
          method === "DELETE" &&
          table === "operation_locks" &&
          this.lock &&
          exact(q, {
            key: "eq.checkout:" + this.m.diagnosis,
            token: "eq." + this.lock,
          })
        ) {
          this.once("unlock");
          ticket.kind = "unlock";
        } else if (
          method === "POST" &&
          table.startsWith("rpc/") &&
          exact(q, {})
        ) {
          const rpc = table.slice(4);
          if (rpc === "consume_limit") {
            const rate = this.rates.get(b.p_key);
            insist(
              rate &&
                exact(b, {
                  p_key: b.p_key,
                  p_limit: rate[0],
                  p_seconds: rate[1],
                }),
            );
            this.once("rate:" + b.p_key, 6);
            ticket.kind = "rate";
          } else if (rpc === "claim_anonymous_diagnoses") {
            insist(
              [...this.tokens.values()].includes(b.p_user) &&
                exact(b, {
                  p_user: b.p_user,
                  p_session: this.sessions[b.p_user],
                }),
            );
            this.once("claim:" + b.p_user);
            ticket.kind = "claim";
          } else if (rpc === "acquire_lock") {
            insist(
              exact(b, {
                p_key: "checkout:" + this.m.diagnosis,
                p_token: b.p_token,
              }) && uuid(b.p_token),
            );
            this.once("lock");
            ticket.kind = "lock";
          } else if (rpc === "apply_stripe_event_v2") {
            const e = this.events.get(b.p_event);
            insist(e && this.flags.has("settled") && this.flags.has("lines"));
            insist(
              exact(b, {
                p_event: e.id,
                p_type: e.type,
                p_hash: e.hash,
                p_session: this.checkout,
                p_intent: this.intent,
                p_payment: this.payment,
                p_amount: 980,
                p_currency: "jpy",
                p_state: "paid",
                p_is_test: true,
                p_customer: this.customer ?? null,
              }),
            );
            this.once("apply:" + e.id, 2);
            ticket.kind = "apply";
          } else insist(false);
        } else insist(false);
      }
    }
    return ticket;
  }
  checkoutForm() {
    return {
      mode: "payment",
      "automatic_tax[enabled]": "false",
      "line_items[0][price]": TARGET.price,
      "line_items[0][quantity]": "1",
      client_reference_id: this.m.diagnosis,
      "metadata[payment_id]": this.payment,
      "metadata[diagnosis_id]": this.m.diagnosis,
      "payment_intent_data[metadata][payment_id]": this.payment,
      "payment_intent_data[metadata][diagnosis_id]": this.m.diagnosis,
      success_url:
        TARGET.app + "/report/" + this.m.diagnosis + "?checkout=complete",
      cancel_url: TARGET.app + "/result/" + this.m.diagnosis,
      integration_identifier: "yorisoi-mvp-qkzmdvpa",
    };
  }
  accept(t, status, data) {
    insist(status >= 200 && status < 300, "UPSTREAM_FAILURE");
    if (t.kind === "account") {
      insist(data.id === TARGET.account);
      this.flags.add("account");
    }
    if (t.kind === "price") {
      this.checkPrice(data);
      this.flags.add("price");
    }
    if (t.kind === "read:payment_environment")
      insist(
        one(data).mode === "sandbox" &&
          one(data).stripe_account_id === TARGET.account,
      );
    if (t.kind === "payment") {
      const p = one(data);
      insist(
        uuid(p.id) &&
          p.user_id === this.m.a.id &&
          p.diagnosis_id === this.m.diagnosis &&
          p.is_test === true &&
          p.amount === 980 &&
          p.price_version === TARGET.version,
      );
      this.payment = p.id;
    }
    if (t.kind === "checkout") {
      insist(
        /^cs_test_[\w]+$/.test(data.id) &&
          new URL(data.url).hostname === "checkout.stripe.com",
      );
      this.checkSession(data);
      this.checkout = data.id;
    }
    if (t.kind === "session") {
      insist(data.id === this.checkout);
      this.checkSession(data);
    }
    if (t.kind === "lines") {
      insist(!data.has_more && data.data?.length === 1);
      const l = data.data[0];
      this.checkPrice(l.price);
      insist(
        l.quantity === 1 && l.amount_total === 980 && l.currency === "jpy",
      );
      this.flags.add("lines");
    }
    if (t.kind === "intent") {
      insist(
        data.id === this.intent &&
          data.livemode === false &&
          data.amount === 980 &&
          data.amount_received === 980 &&
          data.currency === "jpy" &&
          data.status === "succeeded" &&
          data.metadata?.payment_id === this.payment &&
          data.metadata?.diagnosis_id === this.m.diagnosis &&
          (data.customer ?? null) === (this.customer ?? null),
      );
      this.flags.add("settled");
    }
    if (t.kind === "lock") {
      insist(data === true);
      this.lock = t.b.p_token;
    }
    if (t.kind === "unlock") this.lock = null;
    if (t.kind === "claim") insist(data === 0, "UNEXPECTED_CLAIM");
    if (t.kind === "rate") insist(data === true, "RATE_REFUSED");
    if (t.kind === "user")
      insist(data.id === t.user && !!data.email_confirmed_at);
    if (t.kind === "login") {
      insist(
        data.user?.id === t.user &&
          !!data.user.email_confirmed_at &&
          typeof data.refresh_token === "string",
      );
      const payload = JSON.parse(
        Buffer.from(data.access_token.split(".")[1], "base64url"),
      );
      insist(
        payload.iss === TARGET.supabase + "/auth/v1" &&
          payload.sub === t.user &&
          payload.role === "authenticated",
      );
      this.tokens.set(hash(data.access_token), t.user);
      this.refresh.set(hash(data.refresh_token), t.user);
    }
  }
  checkPrice(p) {
    insist(
      p.id === TARGET.price &&
        p.product === TARGET.product &&
        p.livemode === false &&
        p.active === true &&
        p.unit_amount === 980 &&
        p.currency === "jpy" &&
        p.type === "one_time" &&
        p.tax_behavior === "inclusive",
    );
  }
  checkSession(s) {
    insist(
      s.livemode === false &&
        s.mode === "payment" &&
        s.amount_total === 980 &&
        s.currency === "jpy" &&
        s.client_reference_id === this.m.diagnosis &&
        s.metadata?.payment_id === this.payment &&
        s.metadata?.diagnosis_id === this.m.diagnosis,
    );
    if (s.payment_intent && this.intent)
      insist(s.payment_intent === this.intent);
  }
  // Caller MUST verify Stripe signature against raw bytes before invoking this method.
  signedEvent(event, raw) {
    insist(this.ready && !this.stopped && this.checkout);
    insist(
      event.livemode === false &&
        (!event.account || event.account === TARGET.account) &&
        event.type === "checkout.session.completed" &&
        /^evt_[\w]+$/.test(event.id),
    );
    const s = event.data.object;
    this.checkSession(s);
    insist(
      s.id === this.checkout &&
        s.payment_status === "paid" &&
        /^pi_[\w]+$/.test(s.payment_intent),
    );
    insist(!this.intent || this.intent === s.payment_intent);
    this.intent = s.payment_intent;
    this.customer = s.customer ?? null;
    const old = this.events.get(event.id);
    insist((!this.events.size || old) && (!old || old.hash === hash(raw)));
    this.once("webhook:" + event.id, 2);
    this.events.set(event.id, {
      id: event.id,
      type: event.type,
      hash: hash(raw),
    });
  }
}
