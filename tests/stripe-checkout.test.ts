import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  productionSales: false,
  payment: null as Record<string, unknown> | null,
  customer: null as Record<string, unknown> | null,
  kind: "report",
  badPrice: false,
  created: vi.fn(),
  retrieve: vi.fn(),
  lines: vi.fn(),
  expire: vi.fn(),
  subs: vi.fn(),
  cancel: vi.fn(),
  portal: vi.fn(),
  portalLive: false,
  sync: vi.fn(),
  env: { mode: "sandbox", isTest: true },
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("../src/lib/http")>()),
  csrf: vi.fn(),
  owned: async () => ({ status: "free_result_ready", user_id: "user_fixture" }),
  rate: vi.fn(),
  event: vi.fn(),
}));
vi.mock("@/lib/consultation/access", () => ({
  member: async () => "user_fixture",
}));
vi.mock("@/lib/ai/pipeline", () => ({
  lock: async (_key: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/stripe/environment", () => ({
  stripeEnvironment: async () => m.env,
}));
vi.mock("@/lib/stripe/subscriptions", () => ({
  syncSubscription: m.sync,
  stripeId: (v: unknown) =>
    typeof v === "string" ? v : ((v as { id?: string } | null)?.id ?? null),
}));
vi.mock("@/lib/service-settings", () => ({
  serviceSettings: async () => ({ free_limit: 3, plus_limit: 30 }),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({
    rpc: async () => ({ data: m.productionSales, error: null }),
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: (_key: string, v: unknown) => {
          if (table === "price_versions" && _key === "kind") m.kind = String(v);
          return q;
        },
        in: () => q,
        insert: (v: Record<string, unknown>) => {
          if (table === "payments")
            m.payment = { id: "payment_fixture", status: "pending", ...v };
          if (table === "billing_customers") m.customer = { ...v };
          return q;
        },
        update: (v: Record<string, unknown>) => {
          if (table === "payments") m.payment = { ...m.payment, ...v };
          if (table === "billing_customers")
            m.customer = { ...m.customer, ...v };
          return q;
        },
        single: async () => ({ data: data(), error: null }),
        maybeSingle: async () => ({ data: data(), error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve({ data: data(), error: null })),
      };
      function data() {
        if (table === "free_reports") return { id: "free_fixture" };
        if (table === "payments") return m.payment;
        if (table === "billing_customers") return m.customer;
        if (table === "price_versions")
          return {
            id: m.kind + "_v1",
            kind: m.kind,
            is_test: m.env.isTest,
            stripe_price_id: "price_" + m.kind,
            stripe_product_id: "prod_" + m.kind,
            amount: 980,
          };
        if (table === "service_settings")
          return { portal_configuration_id: "bpc_fixture" };
        if (table === "subscriptions") return [{ id: "sub_fixture" }];
        return null;
      }
      return q;
    },
  }),
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: () => ({
    prices: {
      retrieve: async (id: string) => ({
        id,
        product: "prod_" + m.kind,
        active: true,
        livemode: !m.env.isTest,
        currency: "jpy",
        unit_amount: m.badPrice ? 1080 : 980,
        type: m.kind === "plus" ? "recurring" : "one_time",
        recurring:
          m.kind === "plus" ? { interval: "month", interval_count: 1 } : null,
      }),
    },
    checkout: {
      sessions: {
        create: m.created,
        retrieve: m.retrieve,
        listLineItems: m.lines,
        expire: m.expire,
      },
    },
    customers: {
      create: async () => ({ id: "cus_fixture", livemode: !m.env.isTest }),
      retrieve: async () => ({ id: "cus_fixture", livemode: !m.env.isTest }),
    },
    subscriptions: {
      list: m.subs,
      update: m.cancel,
      retrieve: async () => ({
        id: "sub_fixture",
        status: "canceled",
        livemode: false,
      }),
    },
    billingPortal: {
      configurations: {
        retrieve: async () => ({ active: true, livemode: m.portalLive }),
      },
      sessions: { create: m.portal },
    },
  }),
}));
import { POST as report } from "@/app/api/diagnoses/[id]/checkout/route";
import { POST as billing } from "@/app/api/billing/route";
async function buyReport() {
  return report(
    new Request("https://fixture.invalid/api/checkout", { method: "POST" }),
    { params: Promise.resolve({ id: "diagnosis_fixture" }) },
  );
}
async function buyPlus(action = "checkout") {
  return billing(
    new Request("https://fixture.invalid/api/billing", {
      method: "POST",
      body: JSON.stringify({ action, consent: true }),
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_MODE", "sandbox");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fixture.invalid");
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.productionSales = false;
  m.payment = null;
  m.customer = null;
  m.kind = "report";
  m.badPrice = false;
  m.portalLive = false;
  m.env = { mode: "sandbox", isTest: true };
  m.created.mockImplementation(async () => ({
    id: "cs_fixture",
    livemode: !m.env.isTest,
    amount_total: 980,
    currency: "jpy",
    url: "https://checkout.stripe.com/fixture",
  }));
  m.retrieve.mockImplementation(async () => ({
    id: "cs_fixture",
    status: "open",
    livemode: !m.env.isTest,
    mode: m.kind === "plus" ? "subscription" : "payment",
    amount_total: 980,
    currency: "jpy",
    url: "https://checkout.stripe.com/fixture",
    customer: "cus_fixture",
    metadata: {
      user_id: "user_fixture",
      payment_id: "payment_fixture",
      diagnosis_id: "diagnosis_fixture",
    },
    client_reference_id: "diagnosis_fixture",
  }));
  m.lines.mockImplementation(async () => ({
    has_more: false,
    data: [
      {
        quantity: 1,
        amount_total: 980,
        price: { id: "price_" + m.kind, livemode: !m.env.isTest },
      },
    ],
  }));
  m.subs.mockResolvedValue({ data: [] });
  m.portal.mockResolvedValue({ url: "https://billing.stripe.com/fixture" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["report", "plus"])(
  "%s is 980 with tax off; repeated click reuses Checkout",
  async (kind) => {
    const call = kind === "report" ? buyReport : buyPlus;
    const a = await call(),
      b = await call();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect(m.created).toHaveBeenCalledTimes(1);
    expect(m.created.mock.calls[0][0]).toMatchObject({
      automatic_tax: { enabled: false },
      line_items: [{ price: "price_" + kind, quantity: 1 }],
    });
    expect(m.created.mock.calls[0][1].idempotencyKey).toContain("sandbox");
  },
);
it.each(["report", "plus"])(
  "%s rejects wrong server price before creating session",
  async (kind) => {
    m.badPrice = true;
    expect((await (kind === "report" ? buyReport() : buyPlus())).status).toBe(
      503,
    );
    expect(m.created).not.toHaveBeenCalled();
  },
);
it("Preview cannot enable Live Checkout", async () => {
  vi.stubEnv("STRIPE_MODE", "live");
  vi.stubEnv("STRIPE_LIVE_CHECKOUT_ENABLED", "true");
  m.env = { mode: "live", isTest: false };
  expect((await buyPlus()).status).toBe(503);
  expect(m.created).not.toHaveBeenCalled();
});
it("Live checkout remains disabled even in Production until explicitly enabled (mock only)", async () => {
  vi.stubEnv("STRIPE_MODE", "live");
  vi.stubEnv("VERCEL_ENV", "production");
  m.env = { mode: "live", isTest: false };
  expect((await buyPlus()).status).toBe(503);
  expect(m.created).not.toHaveBeenCalled();
  vi.stubEnv("STRIPE_LIVE_CHECKOUT_ENABLED", "true");
  for (const [key, value] of Object.entries({
    PRODUCTION_ENVIRONMENT_ID: "fixture-production",
    PRODUCTION_PUBLIC_ORIGIN: "https://fixture.invalid",
    PRODUCTION_VERCEL_PROJECT_ID: "prj_fixture",
    VERCEL_PROJECT_ID: "prj_fixture",
    PRODUCTION_SUPABASE_REF: "abcdefghijklmnopqrst",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    OPENAI_MODEL: "gpt-6-luna",
    PRODUCTION_OPENAI_PROJECT_ID: "proj_fixture",
    STRIPE_ACCOUNT_ID: "acct_fixture",
    STRIPE_SECRET_KEY: "rk_live_fixture",
    OPENAI_API_KEY: "synthetic",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic",
    SESSION_SECRET: "synthetic",
    CRON_SECRET: "synthetic",
    STRIPE_WEBHOOK_SECRET: "synthetic",
  }))
    vi.stubEnv(key, value);
  expect((await buyPlus()).status).toBe(503);
  expect(m.created).not.toHaveBeenCalled();
  m.productionSales = true;
  expect((await buyPlus()).status).toBe(200);
  expect(m.created.mock.calls[0][1].idempotencyKey).toContain("live");
});
it("active Plus prevents a second subscription", async () => {
  m.customer = {
    user_id: "user_fixture",
    stripe_customer_id: "cus_fixture",
    is_test: true,
  };
  m.subs.mockResolvedValue({
    data: [{ id: "sub_fixture", status: "active", livemode: false }],
  });
  expect((await buyPlus()).status).toBe(409);
  expect(m.created).not.toHaveBeenCalled();
});
it("cancel reserves period-end cancellation and synchronizes", async () => {
  m.customer = {
    user_id: "user_fixture",
    stripe_customer_id: "cus_fixture",
    is_test: true,
  };
  m.subs.mockResolvedValue({
    data: [{ id: "sub_fixture", status: "active", livemode: false }],
  });
  expect((await buyPlus("cancel")).status).toBe(200);
  expect(m.cancel).toHaveBeenCalledWith("sub_fixture", {
    cancel_at_period_end: true,
  });
  expect(m.sync).toHaveBeenCalledWith("sub_fixture");
});
it("a canceled contract can re-subscribe", async () => {
  m.customer = {
    user_id: "user_fixture",
    stripe_customer_id: "cus_fixture",
    is_test: true,
    checkout_session_id: "cs_old",
  };
  m.subs.mockResolvedValue({
    data: [{ id: "sub_fixture", status: "canceled", livemode: false }],
  });
  m.retrieve.mockResolvedValue({
    id: "cs_old",
    livemode: false,
    status: "complete",
    subscription: "sub_fixture",
  });
  expect((await buyPlus()).status).toBe(200);
  expect(m.created).toHaveBeenCalledOnce();
});
it("Portal refuses a configuration from the opposite environment", async () => {
  m.customer = {
    user_id: "user_fixture",
    stripe_customer_id: "cus_fixture",
    is_test: true,
  };
  m.portalLive = true;
  expect((await buyPlus("portal")).status).toBe(503);
  expect(m.portal).not.toHaveBeenCalled();
  m.portalLive = false;
  expect((await buyPlus("portal")).status).toBe(200);
});

it.each(["diagnosis", "reference", "payment"])(
  "refuses reused Checkout with wrong %s binding, without expiring or recreating it",
  async (kind) => {
    await buyReport();
    const previous = await m.retrieve();
    if (kind === "reference") previous.client_reference_id = "other";
    else
      previous.metadata[kind === "diagnosis" ? "diagnosis_id" : "payment_id"] =
        "other";
    m.retrieve.mockResolvedValue(previous);
    expect((await buyReport()).status).toBe(503);
    expect(m.created).toHaveBeenCalledTimes(1);
    expect(m.expire).not.toHaveBeenCalled();
  },
);
