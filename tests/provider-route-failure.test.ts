import { it, expect, vi, beforeEach, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  retrieve: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("../src/lib/http")>()),
  csrf: vi.fn(),
  identity: vi.fn().mockResolvedValue({ session: "fixture", userId: null }),
  owned: vi.fn().mockResolvedValue({ status: "free_result_ready" }),
  rate: vi.fn(),
  rateIP: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: () => ({ prices: { retrieve: mocks.retrieve } }),
}));
vi.mock("@/lib/ai/pipeline", () => ({
  lock: (_key: string, fn: () => Promise<unknown>) => fn(),
}));
import { POST as contact } from "../src/app/api/contact/route";
import { POST as checkout } from "../src/app/api/diagnoses/[id]/checkout/route";
beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "private database detail" },
  });
  mocks.retrieve.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("a Supabase insert failure never returns a successful contact receipt", async () => {
  mocks.from.mockReturnValue({
    insert: () => ({
      select: () => ({
        single: async () => ({
          data: null,
          error: { message: "private database detail" },
        }),
      }),
    }),
  });
  const r = await contact(
    new Request("https://fixture.invalid/api/contact", {
      method: "POST",
      body: JSON.stringify({
        name: "Fixture",
        email: "fixture@example.com",
        message: "Synthetic contact fixture",
        consent: true,
        startedAt: Date.now() - 5000,
      }),
    }),
  );
  expect(r.status).toBe(503);
  const data = await r.json();
  expect(data.id).toBeUndefined();
  expect(data.error).toContain("再度お試しください");
  expect(JSON.stringify(data)).not.toContain("private database");
});
it("a Stripe outage returns a retryable error without creating a payment", async () => {
  mocks.insert.mockReset();
  mocks.from.mockImplementation((table: string) => {
    const data =
      table === "free_reports"
        ? { id: "free_fixture" }
        : table === "price_versions"
          ? { stripe_price_id: "price_fixture", amount: 980, is_test: true }
          : null;
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data, error: null }),
      single: async () => ({ data, error: null }),
      insert: mocks.insert,
    };
    return query;
  });
  mocks.retrieve.mockRejectedValue(new Error("private stripe detail"));
  const r = await checkout(
    new Request("https://fixture.invalid/api/checkout", { method: "POST" }),
    { params: Promise.resolve({ id: "fixture" }) },
  );
  expect(r.status).toBe(503);
  expect(mocks.retrieve).toHaveBeenCalledWith("price_fixture");
  expect(mocks.insert).not.toHaveBeenCalled();
  const data = await r.json();
  expect(data.url).toBeUndefined();
  expect(data.error).toContain("再度お試しください");
  expect(JSON.stringify(data)).not.toContain("private stripe");
});
