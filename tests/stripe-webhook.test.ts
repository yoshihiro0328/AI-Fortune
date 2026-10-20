import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Stripe from "stripe";
const mocks = vi.hoisted(() => ({
  payment: {} as Record<string, unknown>,
  price: {} as Record<string, unknown>,
  session: vi.fn(),
  intent: vi.fn(),
  lines: vi.fn(),
  list: vi.fn(),
  rpc: vi.fn(),
  env: vi.fn(),
  after: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === "payments" ? mocks.payment : mocks.price,
          error: null,
        }),
        single: async () => ({ data: mocks.price, error: null }),
      };
      return q;
    },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/stripe/environment", () => ({ stripeEnvironment: mocks.env }));
vi.mock("@/lib/ai/pipeline", () => ({
  generatePaid: mocks.generate,
  lock: async (_key: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/stripe/client", () => ({
  stripe: () => ({
    webhooks: new Stripe("sk_test_fixture").webhooks,
    checkout: {
      sessions: {
        retrieve: mocks.session,
        listLineItems: mocks.lines,
        list: mocks.list,
      },
    },
    paymentIntents: { retrieve: mocks.intent },
  }),
}));
import { POST } from "@/app/api/webhooks/stripe/route";
import { reportEvent } from "@/lib/stripe/report-event";
const payment = "00000000-0000-4000-8000-000000000001",
  diagnosis = "00000000-0000-4000-8000-000000000002";
function event(
  type = "checkout.session.completed",
  patch: Record<string, unknown> = {},
) {
  return {
    id: "evt_fixture",
    type,
    livemode: false,
    data: {
      object: {
        id: "cs_fixture",
        livemode: false,
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_fixture",
        metadata: { payment_id: payment, diagnosis_id: diagnosis },
        ...patch,
      },
    },
  } as unknown as Stripe.Event;
}
async function deliver(e: Stripe.Event, secret = "whsec_fixture") {
  const raw = JSON.stringify(e);
  return POST(
    new Request("http://fixture/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "stripe-signature": new Stripe(
          "sk_test_fixture",
        ).webhooks.generateTestHeaderString({ payload: raw, secret }),
      },
      body: raw,
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_MODE", "sandbox");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fixture");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.env.mockResolvedValue({ mode: "sandbox", isTest: true });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.payment = {
    id: payment,
    user_id: "00000000-0000-4000-8000-000000000001",
    diagnosis_id: diagnosis,
    amount: 980,
    currency: "jpy",
    is_test: true,
    status: "pending",
    stripe_checkout_session_id: "cs_fixture",
    stripe_payment_intent_id: null,
    stripe_customer_id: null,
    price_version: "report-v1",
  };
  mocks.price = {
    id: "report-v1",
    kind: "report",
    is_test: true,
    stripe_price_id: "price_fixture",
    stripe_product_id: "prod_fixture",
    amount: 980,
  };
  mocks.session.mockResolvedValue({
    id: "cs_fixture",
    livemode: false,
    mode: "payment",
    payment_status: "paid",
    payment_intent: "pi_fixture",
    metadata: { payment_id: payment, diagnosis_id: diagnosis },
    client_reference_id: diagnosis,
    amount_total: 980,
    currency: "jpy",
    customer: null,
  });
  mocks.intent.mockResolvedValue({
    id: "pi_fixture",
    livemode: false,
    amount: 980,
    amount_received: 980,
    currency: "jpy",
    status: "succeeded",
    metadata: { payment_id: payment, diagnosis_id: diagnosis },
    customer: null,
  });
  mocks.lines.mockResolvedValue({
    has_more: false,
    data: [
      {
        quantity: 1,
        amount_total: 980,
        currency: "jpy",
        price: {
          id: "price_fixture",
          type: "one_time",
          unit_amount: 980,
          currency: "jpy",
          livemode: false,
          product: "prod_fixture",
        },
      },
    ],
  });
  mocks.list.mockResolvedValue({
    has_more: false,
    data: [{ id: "cs_fixture" }],
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("signed Sandbox 980 payment commits only after remote verification", async () => {
  expect((await deliver(event())).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "apply_stripe_event_v2",
    expect.objectContaining({
      p_payment: payment,
      p_amount: 980,
      p_is_test: true,
      p_state: "paid",
    }),
  );
});
it.each([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
])("recovers Checkout save race for %s", async (type) => {
  mocks.payment.stripe_checkout_session_id = null;
  expect((await deliver(event(type))).status).toBe(200);
  expect(mocks.session).toHaveBeenCalledWith("cs_fixture");
});
it("an unpaid completion grants no report", async () => {
  expect(
    (await deliver(event(undefined, { payment_status: "unpaid" }))).status,
  ).toBe(200);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("missing PaymentIntent is retried, not silently acknowledged", async () => {
  expect(
    (await deliver(event(undefined, { payment_intent: null }))).status,
  ).toBe(500);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("temporary Stripe retrieval failure returns retry without mutation", async () => {
  mocks.intent.mockRejectedValueOnce(new Error("provider detail"));
  expect((await deliver(event())).status).toBe(500);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("failure before Checkout persistence grants no access and allows a later attempt", async () => {
  mocks.payment.stripe_checkout_session_id = null;
  mocks.list.mockResolvedValue({ has_more: false, data: [] });
  const r = await reportEvent(
    event("payment_intent.payment_failed", { id: "pi_fixture" }),
    "sandbox",
  );
  expect(r).toMatchObject({
    state: "failed",
    session: null,
    intent: "pi_fixture",
  });
});
it("ignores old failed attempt after settlement", async () => {
  mocks.payment.status = "paid";
  mocks.payment.stripe_payment_intent_id = "pi_success";
  expect(
    await reportEvent(
      event("payment_intent.payment_failed", { id: "pi_old" }),
      "sandbox",
    ),
  ).toBe(null);
});
it("full refund is verified and forwarded for revocation", async () => {
  expect(
    (
      await deliver(
        event("charge.refunded", {
          id: "ch_fixture",
          amount: 980,
          currency: "jpy",
          customer: null,
          amount_refunded: 980,
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "apply_stripe_event_v2",
    expect.objectContaining({ p_state: "refunded" }),
  );
});
it.each([
  "wrong signature",
  "event live",
  "object live",
  "wrong customer",
  "wrong price",
  "wrong amount",
  "wrong purchase",
])("rejects %s before writing", async (scenario) => {
  const e = event();
  if (scenario === "event live") e.livemode = true;
  if (scenario === "object live")
    (e.data.object as Stripe.Checkout.Session).livemode = true;
  if (scenario === "wrong customer")
    mocks.intent.mockResolvedValueOnce({
      ...(await mocks.intent()),
      customer: "cus_other",
    });
  if (scenario === "wrong price") mocks.price.stripe_price_id = "price_other";
  if (scenario === "wrong amount") mocks.payment.amount = 1980;
  if (scenario === "wrong purchase")
    mocks.payment.id = "00000000-0000-4000-8000-000000000099";
  expect(
    (
      await deliver(
        e,
        scenario === "wrong signature" ? "whsec_wrong" : "whsec_fixture",
      )
    ).status,
  ).toBeGreaterThanOrEqual(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("refund without Charge metadata resolves the purchase through PaymentIntent", async () => {
  expect(
    (
      await deliver(
        event("charge.refunded", {
          id: "ch_fixture",
          metadata: {},
          amount: 980,
          currency: "jpy",
          customer: null,
          amount_refunded: 980,
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "apply_stripe_event_v2",
    expect.objectContaining({ p_payment: payment, p_state: "refunded" }),
  );
});
it("the original 1980 Sandbox Checkout is still fulfilled", async () => {
  mocks.payment.amount = 1980;
  mocks.payment.price_version = null;
  mocks.intent.mockResolvedValue({
    ...(await mocks.intent()),
    amount: 1980,
    amount_received: 1980,
  });
  mocks.session.mockResolvedValue({
    ...(await mocks.session()),
    amount_total: 1980,
  });
  const lines = await mocks.lines();
  lines.data[0].amount_total = 1980;
  lines.data[0].price.unit_amount = 1980;
  mocks.lines.mockResolvedValue(lines);
  expect((await deliver(event())).status).toBe(200);
});

it("Live fulfillment is tested with mocks only and requires every object to agree", async () => {
  vi.stubEnv("STRIPE_MODE", "live");
  vi.stubEnv("VERCEL_ENV", "production");
  mocks.payment.is_test = false;
  mocks.price.is_test = false;
  mocks.intent.mockResolvedValue({ ...(await mocks.intent()), livemode: true });
  mocks.session.mockResolvedValue({
    ...(await mocks.session()),
    livemode: true,
  });
  const lines = await mocks.lines();
  lines.data[0].price.livemode = true;
  mocks.lines.mockResolvedValue(lines);
  const e = event(undefined, { livemode: true });
  e.livemode = true;
  expect((await deliver(e)).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "apply_stripe_event_v2",
    expect.objectContaining({ p_is_test: false }),
  );
});

it("rejects a signed event from a different connected account before any mutation", async () => {
  const e = event();
  e.account = "acct_other";
  mocks.env.mockResolvedValue({
    mode: "sandbox",
    isTest: true,
    stripe_account_id: "acct_1UQlQdI73kTcvXz8",
  });
  expect((await deliver(e)).status).toBe(500);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("normal webhook still schedules report generation", async () => {
  expect((await deliver(event())).status).toBe(200);
  expect(mocks.after).toHaveBeenCalledOnce();
});
it("local verification fulfills the real purchase RPC without scheduling AI", async () => {
  const { localPaymentEnv } = await import("./helpers/payment-integration");
  localPaymentEnv();
  expect((await deliver(event())).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("invalid local configuration fails before purchase mutation", async () => {
  vi.stubEnv("PAYMENT_INTEGRATION_LOCAL", "true");
  expect((await deliver(event())).status).toBe(500);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.after).not.toHaveBeenCalled();
});
it("local verification rejects a different diagnosis and subscription events", async () => {
  const { localPaymentEnv } = await import("./helpers/payment-integration");
  localPaymentEnv();
  vi.stubEnv(
    "PAYMENT_INTEGRATION_DIAGNOSIS_ID",
    "00000000-0000-4000-8000-000000000099",
  );
  expect((await deliver(event())).status).toBe(500);
  expect((await deliver(event("customer.subscription.updated"))).status).toBe(
    500,
  );
  expect(
    (
      await deliver(
        event(undefined, { mode: "subscription", subscription: "sub_fixture" }),
      )
    ).status,
  ).toBe(500);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("signed handler and real PostgreSQL fulfillment commit once together (offline providers)", async () => {
  const { isolatedDb, applyIsolation, migrationName } =
    await import("./helpers/isolated-db");
  const { readFile, readdir } = await import("node:fs/promises");
  const { localPaymentEnv } = await import("./helpers/payment-integration");
  localPaymentEnv();
  const pg = await isolatedDb();
  try {
    await applyIsolation(pg);
    for (const name of (await readdir("supabase/migrations"))
      .filter((n) => n.endsWith(".sql") && n > migrationName)
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + name, "utf8"));
    await pg.query(
      "insert into auth.users(id,email_confirmed_at) values($1,now())",
      [mocks.payment.user_id],
    );
    await pg.query(
      "insert into diagnoses(id,user_id,anonymous_session_id,diagnosis_type_id,status) values($1,$2,'synthetic-only',(select id from diagnosis_types limit 1),'free_result_ready')",
      [diagnosis, mocks.payment.user_id],
    );
    await pg.query(
      "insert into payments(id,diagnosis_id,user_id,amount,stripe_checkout_session_id) values($1,$2,$3,980,'cs_fixture')",
      [payment, diagnosis, mocks.payment.user_id],
    );
    mocks.rpc.mockImplementation(async (name, p) => {
      expect(name).toBe("apply_stripe_event_v2");
      const result = await pg.query<{ applied: boolean }>(
        "select apply_stripe_event_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) applied",
        [
          p.p_event,
          p.p_type,
          p.p_hash,
          p.p_session,
          p.p_intent,
          p.p_payment,
          p.p_amount,
          p.p_currency,
          p.p_state,
          p.p_is_test,
          p.p_customer,
        ],
      );
      return { data: result.rows[0].applied, error: null };
    });
    expect((await deliver(event())).status).toBe(200);
    expect((await deliver(event())).status).toBe(200);
    const counts = await pg.query(
      "select (select count(*)::int from payments where status='paid') purchases,(select count(*)::int from paid_reports) reports,(select count(*)::int from stripe_events) events,(select count(*)::int from ai_calls) ai",
    );
    expect(counts.rows).toEqual([
      { purchases: 1, reports: 1, events: 1, ai: 0 },
    ]);
    expect(mocks.after).not.toHaveBeenCalled();
  } finally {
    await pg.close();
  }
}, 30000);
