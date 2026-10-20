import test from "node:test";
import assert from "node:assert/strict";
import { Policy, TARGET, hash } from "./policy.mjs";
import { deactivatePrice, finish, verifyRevoked } from "./cleanup.mjs";
import { appEnvironment, copyApplication } from "./launch.mjs";
import { listenerArgs, sandboxProfile } from "./processes.mjs";
import {
  m,
  paymentId,
  price,
  version,
  session,
  jwt,
} from "./offline-fixture.mjs";
const sb = (path, method = "GET", body = null) => ({
  url: TARGET.supabase + "/rest/v1/" + path,
  method,
  headers: { apikey: "local-service", authorization: "Bearer local-service" },
  body: body ? JSON.stringify(body) : "",
});
const stripe = (path, method = "GET", body = {}) => ({
  url: TARGET.stripe + path,
  method,
  headers: {
    authorization: "Bearer rk_test_local_proxy",
    "idempotency-key": `checkout:sandbox:${paymentId}:initial`,
  },
  body: method === "GET" ? "" : new URLSearchParams(body).toString(),
});
const policy = () => {
  const p = new Policy(m);
  p.ready = true;
  return p;
};
for (const [label, r] of [
  [
    "old Supabase",
    {
      ...sb("diagnoses"),
      url: "https://rnvrdrfdbapfafwjbygo.supabase.co/rest/v1/diagnoses",
    },
  ],
  [
    "OpenAI",
    { ...stripe("/v1/account"), url: "https://api.openai.com/v1/models" },
  ],
  ["arbitrary RPC", sb("rpc/arbitrary", "POST", {})],
  ["trial enable", sb("rpc/trial_activate", "POST", {})],
  [
    "account override",
    {
      ...stripe("/v1/account"),
      headers: {
        authorization: "Bearer rk_test_local_proxy",
        "stripe-account": TARGET.account,
      },
    },
  ],
  [
    "Stripe live key",
    {
      ...stripe("/v1/account"),
      headers: { authorization: "Bearer rk_live_synthetic" },
    },
  ],
  ["other price", stripe("/v1/prices/price_other")],
  ["refund", stripe("/v1/refunds", "POST")],
  ["Portal", stripe("/v1/billing_portal/sessions", "POST")],
  [
    "user creation",
    {
      ...sb(""),
      url: TARGET.supabase + "/auth/v1/signup",
      method: "POST",
      body: "{}",
    },
  ],
  ["arbitrary DB INSERT", sb("diagnoses", "POST", {})],
  ["price activation", sb("price_versions", "PATCH", { active: true })],
  ["all payments", sb("payments?select=*")],
  ["diagnosis other id", sb("diagnoses?id=eq.other")],
  [
    "join expansion",
    sb("diagnoses?id=eq." + m.diagnosis + "&select=*,profiles(*)"),
  ],
  ["extra OR", sb("diagnoses?id=eq." + m.diagnosis + "&or=(id.neq.x)")],
  [
    "schema routing",
    {
      ...sb("diagnoses?id=eq." + m.diagnosis),
      headers: {
        apikey: "local-service",
        authorization: "Bearer local-service",
        "accept-profile": "auth",
      },
    },
  ],
  ["bulk delete", sb("operation_locks", "DELETE")],
  ["duplicate filters", sb("diagnoses?id=eq." + m.diagnosis + "&id=eq.other")],
])
  test("rejects " + label, () => assert.throws(() => policy().authorize(r)));
test("not ready and stopped both fail before forwarding", () => {
  const p = new Policy(m);
  assert.throws(() => p.authorize(stripe("/v1/account")));
  p.ready = true;
  p.stopped = true;
  assert.throws(() => p.authorize(stripe("/v1/account")));
});
test("allowlist headers do not substitute for the API body guard", () =>
  assert.throws(() =>
    policy().authorize(
      sb("rpc/consume_limit", "POST", {
        p_key: "checkout:" + m.diagnosis,
        p_limit: 999,
        p_seconds: 3600,
      }),
    ),
  ));
test("fresh lock reservation has actual application argument shape", () => {
  const p = policy();
  const t = p.authorize(
    sb("rpc/acquire_lock", "POST", {
      p_key: "checkout:" + m.diagnosis,
      p_token: m.run,
    }),
  );
  p.accept(t, 200, true);
  assert.equal(p.lock, m.run);
  assert.throws(() =>
    p.authorize(
      sb("rpc/acquire_lock", "POST", {
        p_key: "checkout:" + m.diagnosis,
        p_token: m.run,
      }),
    ),
  );
});
test("one payment and Checkout, no duplicate or modified buyer", () => {
  const p = policy();
  p.lock = m.run;
  p.flags.add("account");
  p.flags.add("price");
  const body = {
    diagnosis_id: m.diagnosis,
    user_id: m.a.id,
    amount: 980,
    is_test: true,
    price_version: TARGET.version,
  };
  assert.throws(() =>
    p.authorize(sb("payments?select=*", "POST", { ...body, user_id: m.b.id })),
  );
  p.accept(p.authorize(sb("payments?select=*", "POST", body)), 201, {
    id: paymentId,
    ...body,
  });
  assert.throws(() => p.authorize(sb("payments?select=*", "POST", body)));
  p.accept(
    p.authorize(stripe("/v1/checkout/sessions", "POST", p.checkoutForm())),
    200,
    session,
  );
  assert.throws(() =>
    p.authorize(stripe("/v1/checkout/sessions", "POST", p.checkoutForm())),
  );
});
test("reservation failure happens before authorization can return", () => {
  const p = new Policy(m, () => {
    throw new Error("DISK_FULL");
  });
  p.ready = true;
  assert.throws(
    () =>
      p.authorize(
        sb("rpc/acquire_lock", "POST", {
          p_key: "checkout:" + m.diagnosis,
          p_token: m.run,
        }),
      ),
    /DISK_FULL/,
  );
});
test("DB event RPC cannot precede a verified event", () =>
  assert.throws(() =>
    policy().authorize(
      sb("rpc/apply_stripe_event_v2", "POST", { p_event: "evt_fake" }),
    ),
  ));
for (const changed of [
  { livemode: true },
  { amount_total: 1980 },
  { currency: "usd" },
  { client_reference_id: m.b.id },
])
  test("rejects Checkout binding mismatch " + Object.keys(changed)[0], () =>
    assert.throws(() => policy().checkSession({ ...session, ...changed })),
  );
for (const changed of [
  { livemode: true },
  { unit_amount: 1980 },
  { tax_behavior: "exclusive" },
  { product: "prod_other" },
])
  test("rejects price mismatch " + Object.keys(changed)[0], () =>
    assert.throws(() => policy().checkPrice({ ...price, ...changed })),
  );
test("login limited to A/B, verified response bound to new project", () => {
  const p = policy();
  const r = {
    url: TARGET.supabase + "/auth/v1/token?grant_type=password",
    method: "POST",
    headers: { apikey: "local-anon", authorization: "Bearer local-anon" },
    body: JSON.stringify({ email: m.a.email, password: "SyntheticOnly123!" }),
  };
  const t = p.authorize(r);
  p.accept(t, 200, {
    user: { id: m.a.id, email_confirmed_at: "now" },
    access_token: jwt(m.a.id),
    refresh_token: "synthetic-refresh",
  });
  assert.equal(p.tokens.get(hash(jwt(m.a.id))), m.a.id);
  assert.throws(() => p.authorize(r));
  assert.throws(() =>
    p.accept(t, 200, {
      user: { id: m.b.id, email_confirmed_at: "now" },
      access_token: jwt(m.b.id),
      refresh_token: "synthetic-refresh",
    }),
  );
});
test("empty anonymous claim must remain empty", () => {
  const p = policy();
  p.tokens.set("synthetic", m.a.id);
  const t = p.authorize(
    sb("rpc/claim_anonymous_diagnoses", "POST", {
      p_user: m.a.id,
      p_session: p.sessions[m.a.id],
    }),
  );
  assert.throws(() => p.accept(t, 200, 1));
});
function priceStore(fail = false) {
  let rows = [
    version,
    ...Array.from({ length: 5 }, (_, i) => ({ id: "old" + i, active: false })),
  ].map((x) => ({ ...x }));
  let patches = 0;
  return {
    get rows() {
      return rows;
    },
    get patches() {
      return patches;
    },
    request: async (method, url, body) => {
      if (url.startsWith("payment_environment"))
        return [{ mode: "sandbox", stripe_account_id: TARGET.account }];
      if (method === "PATCH") {
        patches++;
        if (fail) throw new Error("Unknown");
        assert.deepEqual(body, { active: false });
        rows = rows.map((x) =>
          x.id === TARGET.version ? { ...x, ...body } : x,
        );
        return [rows[0]];
      }
      return structuredClone(rows);
    },
  };
}
test("shutdown disables only target price and verifies all other values", async () => {
  const store = priceStore();
  await deactivatePrice(store.request);
  assert.equal(store.patches, 1);
  assert(store.rows.every((x) => !x.active));
});
test("unknown external write result is not retried", async () => {
  const store = priceStore(true);
  await assert.rejects(deactivatePrice(store.request));
  assert.equal(store.patches, 1);
});
for (const reason of ["operator_finished", "startup_failure", "interrupted"])
  test(
    "shutdown handles " + reason + " and never claims keys were revoked",
    async () => {
      const order = [];
      const r = await finish({
        reason,
        keys: ["rk_test_synthetic"],
        stopProcesses: async () => order.push("stop"),
        deactivate: async () => order.push("price"),
        eraseTemporary: async () => order.push("erase"),
      });
      assert.deepEqual(order, ["stop", "price", "erase"]);
      assert.equal(r.complete, false);
      assert.equal(r.temporary, "deleted");
      assert.equal(r.keys[0].state, "manual_revocation_pending");
    },
  );
test("cleanup continues after process/price errors and records residuals", async () => {
  let erased = false;
  const r = await finish({
    keys: ["rk_test_synthetic"],
    reason: "failed",
    stopProcesses: async () => {
      throw Error();
    },
    deactivate: async () => {
      throw Error();
    },
    eraseTemporary: async () => {
      erased = true;
    },
  });
  assert(erased);
  assert.equal(r.processes, "failed_or_unknown");
  assert.equal(r.price, "failed_or_unknown");
  assert(!r.complete);
});
for (const status of [200, 403, 429, 500])
  test("key revocation not inferred from HTTP " + status, async () =>
    assert.equal(
      (
        await verifyRevoked("rk_test_fake", async () => ({
          status,
          code: "api_key_expired",
        }))
      ).state,
      "unconfirmed",
    ),
  );
test("revocation requires explicit 401 expired/invalid error", async () =>
  assert.equal(
    (
      await verifyRevoked("rk_test_fake", async () => ({
        status: 401,
        code: "api_key_expired",
      }))
    ).state,
    "verified_revoked",
  ));
test("app environment contains no real provider keys or inherited proxy/CLI configuration", () => {
  const e = appEnvironment(m, {
    token: "fake",
    forward: "fake",
    webhook: "whsec_fake",
  });
  assert.equal(e.SUPABASE_SERVICE_ROLE_KEY, "local-service");
  assert.equal(e.STRIPE_SECRET_KEY, "rk_test_local_proxy");
  for (const n of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
    "OPENAI_API_KEY",
    "STRIPE_API_KEY",
    "HOME",
  ])
    assert.equal(e[n], undefined);
});
test("CLI command explicitly scopes project/event, no trigger or live/load flags", () => {
  const args = listenerArgs(m.run);
  assert(args.includes("checkout.session.completed"));
  assert(args.includes("http://127.0.0.1:5209/webhook"));
  assert(!args.some((x) => /live|trigger|load-from|print-json/.test(x)));
});
test("sandbox permits only the broker port and denies credential directory", () => {
  const s = sandboxProfile("/tmp");
  assert(s.includes("(deny network-outbound)"));
  assert(s.includes("localhost:5209"));
  assert(s.includes("(deny file-read*"));
});
// Keep the exported copy routine checked without running or copying a real .env.
void copyApplication;
