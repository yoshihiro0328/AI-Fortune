import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import {
  stripeMode,
  assertStripeMode,
  assertCheckoutEnabled,
} from "@/lib/stripe/mode";
import { stripe } from "@/lib/stripe/client";
import { paidSession } from "@/lib/stripe/verify";
const mocks = vi.hoisted(() => ({
  row: { mode: "sandbox", stripe_account_id: "acct_fixture" },
  error: null as unknown,
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({
    from: () => ({
      select: () => ({
        single: async () => ({ data: mocks.row, error: mocks.error }),
      }),
    }),
  }),
}));
import { paymentEnvironment } from "@/lib/stripe/environment";
beforeEach(() => {
  vi.stubEnv("STRIPE_MODE", "sandbox");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_fixture");
  mocks.row = { mode: "sandbox", stripe_account_id: "acct_fixture" };
  mocks.error = null;
});
afterEach(() => vi.unstubAllEnvs());
describe("fail-closed environment boundaries", () => {
  it.each([undefined, "", "test", "Sandbox", "production"])(
    "rejects unknown mode %s",
    (mode) => {
      vi.stubEnv("STRIPE_MODE", mode);
      expect(() => stripeMode()).toThrow();
    },
  );
  it.each(["preview", "development", undefined])(
    "never allows Live in %s",
    (target) => {
      vi.stubEnv("STRIPE_MODE", "live");
      vi.stubEnv("VERCEL_ENV", target);
      expect(() => stripeMode()).toThrow();
    },
  );
  it("rejects Sandbox in Production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => stripeMode()).toThrow();
  });
  it.each(["sk_live_fixture", "rk_live_fixture", "pk_test_fixture", "invalid"])(
    "rejects wrong Sandbox key %s",
    (key) => {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      expect(() => stripe()).toThrow();
    },
  );
  it.each(["sk_test_fixture", "rk_test_fixture"])(
    "accepts Sandbox server key %s without API calls",
    (key) => {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      expect(stripe()).toBeTruthy();
    },
  );
  it("requires an additional explicit Live checkout gate", () => {
    vi.stubEnv("STRIPE_MODE", "live");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_fixture");
    expect(stripe()).toBeTruthy();
    expect(() => assertCheckoutEnabled()).toThrow();
    vi.stubEnv("STRIPE_LIVE_CHECKOUT_ENABLED", "true");
    expect(() => assertCheckoutEnabled()).not.toThrow();
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_fixture");
    expect(() => stripe()).toThrow();
  });
  it.each([true, undefined])(
    "rejects mismatching/missing object livemode %s",
    (livemode) => {
      expect(() => assertStripeMode({ livemode })).toThrow();
    },
  );
  it("requires matching Live object", () => {
    expect(() => assertStripeMode({ livemode: true }, "live")).not.toThrow();
    expect(() => assertStripeMode({ livemode: false }, "live")).toThrow();
  });
  it("accepts only the matching DB and account binding", async () => {
    expect((await paymentEnvironment()).isTest).toBe(true);
    mocks.row.mode = "live";
    await expect(paymentEnvironment()).rejects.toThrow();
    mocks.row.mode = "sandbox";
    mocks.row.stripe_account_id = "acct_other";
    await expect(paymentEnvironment()).rejects.toThrow();
  });
  it("never falls back to Sandbox after a DB error", async () => {
    mocks.error = { message: "offline" };
    await expect(paymentEnvironment()).rejects.toThrow();
  });
  it("accepts Live only with Live DB and explicit Production", async () => {
    vi.stubEnv("STRIPE_MODE", "live");
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.row.mode = "live";
    expect((await paymentEnvironment()).isTest).toBe(false);
  });
  it("legacy 1980 is supported only for Sandbox; Live is 980", () => {
    const s = {
      livemode: true,
      mode: "payment",
      payment_status: "paid",
      amount_total: 980,
      currency: "jpy",
      metadata: { payment_id: "p" },
    } as unknown as Stripe.Checkout.Session;
    expect(paidSession(s, "live")).toBe(true);
    expect(paidSession({ ...s, amount_total: 1980 }, "live")).toBe(false);
    expect(
      paidSession({ ...s, livemode: false, amount_total: 1980 }, "sandbox"),
    ).toBe(true);
  });
});
