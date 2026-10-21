import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  published: false,
  filters: new Map<string, unknown>(),
  retrieve: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  db: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => {
          fixture.filters.set(field, value);
          return query;
        },
        single: async () =>
          fixture.filters.get("active") === true && !fixture.published
            ? { data: null, error: new Error("no published price") }
            : {
                data: {
                  stripe_price_id: "price_synthetic",
                  stripe_product_id: "prod_synthetic",
                  active: fixture.published,
                  amount: 980,
                  is_test: true,
                },
                error: null,
              },
      };
      return query;
    },
  }),
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: () => ({ prices: { retrieve: fixture.retrieve } }),
}));
vi.mock("@/lib/stripe/environment", () => ({
  stripeEnvironment: async () => ({ isTest: true, mode: "test" }),
}));
import { offer } from "@/lib/stripe/catalog";

beforeEach(() => {
  fixture.published = false;
  fixture.filters.clear();
  fixture.retrieve.mockReset();
});
it("unpublished DB price prevents offering even an active Stripe catalog price", async () => {
  fixture.retrieve.mockResolvedValue({ active: true });
  await expect(offer("plus")).rejects.toThrow("no published price");
  expect(fixture.retrieve).not.toHaveBeenCalled();
  expect(fixture.filters.get("is_test")).toBe(true);
});
it("publishing DB price cannot bypass inactive Stripe price", async () => {
  fixture.published = true;
  fixture.retrieve.mockResolvedValue({
    product: "prod_synthetic",
    livemode: false,
    active: false,
  });
  await expect(offer("plus")).rejects.toThrow("Invalid catalog price");
});
