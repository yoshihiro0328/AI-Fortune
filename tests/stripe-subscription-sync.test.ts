import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type Stripe from "stripe";
const m = vi.hoisted(() => ({
  retrieve: vi.fn(),
  invoices: vi.fn(),
  rpc: vi.fn(),
  binding: { user_id: "owner", is_test: true },
  version: {
    id: "plus-v1",
    amount: 980,
    is_test: true,
    stripe_product_id: "prod_plus",
  },
}));
vi.mock("@/lib/stripe/environment", () => ({
  stripeEnvironment: async () => ({ mode: "sandbox", isTest: true }),
}));
vi.mock("@/lib/ai/pipeline", () => ({
  lock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: () => ({
    subscriptions: { retrieve: m.retrieve },
    invoices: { list: m.invoices },
  }),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({
    rpc: m.rpc,
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: table === "billing_customers" ? m.binding : m.version,
          error: null,
        }),
      };
      return q;
    },
  }),
}));
import {
  syncSubscription,
  subscriptionFromEvent,
} from "@/lib/stripe/subscriptions";
beforeEach(() => {
  vi.clearAllMocks();
  m.binding = { user_id: "owner", is_test: true };
  m.version = {
    id: "plus-v1",
    amount: 980,
    is_test: true,
    stripe_product_id: "prod_plus",
  };
  m.retrieve.mockResolvedValue({
    id: "sub_fixture",
    livemode: false,
    customer: "cus_fixture",
    metadata: { user_id: "owner" },
    status: "active",
    created: 1000,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: 1000,
          current_period_end: 2000,
          price: {
            id: "price_plus",
            product: "prod_plus",
            livemode: false,
            currency: "jpy",
            unit_amount: 980,
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
  });
  m.invoices.mockResolvedValue({
    data: [
      {
        id: "in_fixture",
        livemode: false,
        customer: "cus_fixture",
        parent: { subscription_details: { subscription: "sub_fixture" } },
        currency: "jpy",
        amount_paid: 980,
        total: 980,
        status: "paid",
        created: 1000,
        status_transitions: { paid_at: 1000 },
        lines: {
          has_more: false,
          data: [
            {
              quantity: 1,
              period: { start: 1000, end: 2000 },
              pricing: { price_details: { price: "price_plus" } },
            },
          ],
        },
      },
    ],
  });
  m.rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.restoreAllMocks());
it("a paid invoice sets the matching paid-through date", async () => {
  await syncSubscription("sub_fixture");
  expect(m.rpc).toHaveBeenCalledWith(
    "apply_subscription_snapshot",
    expect.objectContaining({
      p_snapshot: expect.objectContaining({
        is_test: true,
        amount: 980,
        paid_through: new Date(2000 * 1000).toISOString(),
        user_id: "owner",
      }),
    }),
  );
});
it("a failed renewal never advances access to the unpaid period", async () => {
  const original = await m.invoices();
  m.invoices.mockResolvedValue({
    data: [
      {
        ...original.data[0],
        id: "in_unpaid",
        status: "open",
        amount_paid: 0,
        lines: {
          has_more: false,
          data: [
            {
              ...original.data[0].lines.data[0],
              period: { start: 2000, end: 3000 },
            },
          ],
        },
      },
      ...original.data,
    ],
  });
  await syncSubscription("sub_fixture");
  expect(m.rpc.mock.calls[0][1].p_snapshot.paid_through).toBe(
    new Date(2000 * 1000).toISOString(),
  );
});
it("an old event re-fetches current cancellation instead of restoring old state", async () => {
  const current = await m.retrieve();
  m.retrieve.mockResolvedValue({
    ...current,
    status: "canceled",
    cancel_at_period_end: true,
    canceled_at: 1500,
  });
  await syncSubscription("sub_fixture", {
    id: "evt_old",
    type: "customer.subscription.created",
    hash: "old",
  });
  expect(m.rpc.mock.calls[0][1].p_snapshot).toMatchObject({
    status: "canceled",
    cancel_at_period_end: true,
  });
  expect(m.retrieve).toHaveBeenLastCalledWith("sub_fixture", {
    expand: ["latest_invoice"],
  });
});
it.each([
  "mode",
  "owner",
  "price",
  "currency",
  "amount",
  "customer",
  "subscription",
])("rejects mismatching %s without changing DB", async (field) => {
  const sub = await m.retrieve(),
    invoices = await m.invoices();
  if (field === "mode") sub.livemode = true;
  if (field === "owner") sub.metadata.user_id = "other";
  if (field === "price") sub.items.data[0].price.product = "prod_other";
  if (field === "currency") invoices.data[0].currency = "usd";
  if (field === "amount") invoices.data[0].amount_paid = 1;
  if (field === "customer") invoices.data[0].customer = "cus_other";
  if (field === "subscription")
    invoices.data[0].parent.subscription_details.subscription = "sub_other";
  m.retrieve.mockResolvedValue(sub);
  m.invoices.mockResolvedValue(invoices);
  await expect(syncSubscription("sub_fixture")).rejects.toThrow();
  expect(m.rpc).not.toHaveBeenCalled();
});
it.each([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "checkout.session.completed",
])("routes required event %s", async (type) => {
  expect(
    await subscriptionFromEvent({
      type,
      data: {
        object: {
          id: "sub_fixture",
          mode: "subscription",
          subscription: "sub_fixture",
          parent: { subscription_details: { subscription: "sub_fixture" } },
        },
      },
    } as unknown as Stripe.Event),
  ).toBe("sub_fixture");
});
