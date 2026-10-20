// Synthetic provider responses ONLY. This module is never imported by the live launcher.
import { TARGET, insist } from "./policy.mjs";
export const m = {
  run: "10000000-0000-4000-8000-000000000001",
  diagnosis: "10000000-0000-4000-8000-000000000002",
  answer: "10000000-0000-4000-8000-000000000006",
  freeReport: "10000000-0000-4000-8000-000000000007",
  type: "10000000-0000-4000-8000-000000000008",
  anonymousHash: "d".repeat(64),
  a: {
    id: "10000000-0000-4000-8000-000000000003",
    email: "a@example.invalid",
    cookie: "a".repeat(43),
  },
  b: {
    id: "10000000-0000-4000-8000-000000000004",
    email: "b@example.invalid",
    cookie: "b".repeat(43),
  },
  sessionSecret: "c".repeat(64),
};
export const paymentId = "10000000-0000-4000-8000-000000000005";
export const price = {
  id: TARGET.price,
  product: TARGET.product,
  livemode: false,
  active: true,
  unit_amount: 980,
  currency: "jpy",
  type: "one_time",
  tax_behavior: "inclusive",
};
export const version = {
  id: TARGET.version,
  stripe_price_id: TARGET.price,
  stripe_product_id: TARGET.product,
  amount: 980,
  currency: "jpy",
  active: true,
  is_test: true,
  kind: "report",
};
export const session = {
  id: "cs_test_fixture",
  url: "https://checkout.stripe.com/c/pay/cs_test_fixture",
  livemode: false,
  mode: "payment",
  amount_total: 980,
  currency: "jpy",
  client_reference_id: m.diagnosis,
  metadata: { payment_id: paymentId, diagnosis_id: m.diagnosis },
  status: "open",
  payment_status: "unpaid",
  customer: null,
};
export function jwt(user) {
  return [
    "eyJhbGciOiJIUzI1NiJ9",
    Buffer.from(
      JSON.stringify({
        iss: TARGET.supabase + "/auth/v1",
        sub: user,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "synthetic",
  ].join(".");
}
export function mockProvider() {
  const state = {
    payment: null,
    applied: new Set(),
    paidReports: 0,
    calls: [],
    event: null,
  };
  const transport = async (r) => {
    const u = new URL(r.url),
      h = new Headers(r.headers),
      q = Object.fromEntries(u.searchParams);
    let out;
    state.calls.push(r.method + " " + u.pathname);
    const b = r.body
      ? u.origin === TARGET.stripe
        ? Object.fromEntries(new URLSearchParams(r.body))
        : JSON.parse(r.body)
      : {};
    if (u.origin === TARGET.stripe) {
      if (u.pathname === "/v1/account") out = { id: TARGET.account };
      else if (u.pathname === "/v1/prices/" + TARGET.price) out = price;
      else if (u.pathname === "/v1/checkout/sessions" && r.method === "POST")
        out = session;
      else if (u.pathname === "/v1/checkout/sessions/cs_test_fixture")
        out = {
          ...session,
          payment_intent: "pi_fixture",
          payment_status: "paid",
          status: "complete",
        };
      else if (u.pathname.endsWith("/line_items"))
        out = {
          data: [{ quantity: 1, amount_total: 980, currency: "jpy", price }],
          has_more: false,
        };
      else if (u.pathname === "/v1/payment_intents/pi_fixture")
        out = {
          id: "pi_fixture",
          livemode: false,
          amount: 980,
          amount_received: 980,
          currency: "jpy",
          status: "succeeded",
          metadata: session.metadata,
          customer: null,
        };
      else insist(false, "MOCK_UNKNOWN_STRIPE");
    } else if (u.pathname === "/auth/v1/token") {
      const user = b.email === m.a.email ? m.a : m.b;
      out = {
        access_token: jwt(user.id),
        refresh_token: "synthetic-refresh-" + user.id,
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: user.id,
          email: user.email,
          email_confirmed_at: "2026-01-01T00:00:00Z",
          aud: "authenticated",
          role: "authenticated",
        },
      };
    } else if (u.pathname === "/auth/v1/user") {
      const payload = JSON.parse(
        Buffer.from(h.get("authorization").slice(7).split(".")[1], "base64url"),
      );
      const user = payload.sub === m.a.id ? m.a : m.b;
      out = {
        id: user.id,
        email_confirmed_at: "2026-01-01T00:00:00Z",
        email: user.email,
      };
    } else {
      const t = u.pathname.split("/").pop();
      if (t === "consume_limit" || t === "acquire_lock") out = true;
      else if (t === "claim_anonymous_diagnoses") out = 0;
      else if (t === "apply_stripe_event_v2") {
        out = !state.applied.has(b.p_event);
        if (out) {
          state.applied.add(b.p_event);
          state.payment.status = "paid";
          state.paidReports++;
        }
      } else if (t === "operation_locks" || t === "analytics_events")
        return { status: 204, text: "" };
      else {
        let rows = [];
        if (t === "payment_environment")
          rows = [{ mode: "sandbox", stripe_account_id: TARGET.account }];
        if (t === "price_versions") rows = [version];
        if (t === "diagnoses")
          rows = [
            {
              id: m.diagnosis,
              user_id: m.a.id,
              status: "free_result_ready",
              question_flow_version: "v1",
              anonymous_session_id: "synthetic",
              classification_json: { risk_detected: false },
            },
          ].filter((x) => !q.user_id || q.user_id === "eq." + x.user_id);
        if (t === "free_reports")
          rows = [
            {
              id: "synthetic-free",
              diagnosis_id: m.diagnosis,
              report_json: {},
            },
          ];
        if (t === "diagnosis_answers") rows = [];
        if (t === "paid_reports")
          rows = state.paidReports
            ? [{ status: "queued", report_json: null, attempts: 0 }]
            : [];
        if (t === "payments") {
          if (r.method === "POST")
            state.payment = {
              id: paymentId,
              currency: "jpy",
              status: "pending",
              ...b,
            };
          if (r.method === "PATCH") {
            Object.assign(state.payment, b);
            return { status: 204, text: "" };
          }
          rows = state.payment ? [state.payment] : [];
        }
        out = h.get("accept")?.includes("vnd.pgrst.object")
          ? (rows[0] ?? null)
          : rows;
      }
    }
    return { status: 200, text: JSON.stringify(out) };
  };
  return { state, transport };
}
