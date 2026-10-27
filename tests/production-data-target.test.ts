import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(() => ({})) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: m.create }));
import { db, checked } from "@/lib/supabase/admin";
import { assertProductionDataTarget } from "@/lib/production/config";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("rejects mismatched production data before constructing a client", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("PRODUCTION_SUPABASE_REF", "abcdefghijklmnopqrst");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other.example.org");
  expect(() => db()).toThrow("Production operation unavailable");
  expect(m.create).not.toHaveBeenCalled();
});
it("keeps data access independent of generation secrets while requiring its exact target", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("PRODUCTION_SUPABASE_REF", "abcdefghijklmnopqrst");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://abcdefghijklmnopqrst.supabase.co",
  );
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic");
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(() => db()).not.toThrow();
  expect(m.create).toHaveBeenCalledTimes(1);
});
it("does not permit a production-labelled runtime on a preview deployment", () => {
  expect(() =>
    assertProductionDataTarget({
      APP_RUNTIME: "production",
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      PRODUCTION_SUPABASE_REF: "abcdefghijklmnopqrst",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    }),
  ).toThrow("Production operation unavailable");
});

it("never attaches private database details to an exception reaching server rendering", () => {
  try {
    checked({
      data: null,
      error: { message: "synthetic-private-value", details: "private row" },
    });
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Database operation failed");
    expect((error as Error).cause).toBeUndefined();
    return;
  }
  throw Error("expected fixed database error");
});
