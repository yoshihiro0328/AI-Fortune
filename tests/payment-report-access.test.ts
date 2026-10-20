import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: null as null | { id: string; email_confirmed_at: string | null },
  cookie: true,
  payment: { status: "paid", is_test: true },
  reports: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () =>
      m.cookie
        ? [{ name: "sb-fixture-auth-token", value: "synthetic-token" }]
        : [],
    set: vi.fn(),
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: m.user } }) },
  }),
}));
vi.mock("@/lib/stripe/environment", () => ({
  paymentEnvironment: async () => ({ isTest: true }),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({
    from: (table: string) => {
      const data = () => {
        if (table === "diagnoses")
          return {
            user_id: "buyer-a",
            anonymous_session_id: "fixture-hash",
            status: "report_ready",
            question_flow_version: "v1",
          };
        if (table === "payments") return m.payment;
        if (table === "paid_reports") {
          m.reports();
          return {
            status: "ready",
            report_json: { synthetic: true },
            attempts: 0,
          };
        }
        return [];
      };
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: data(), error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve({ data: data(), error: null })),
      };
      return q;
    },
  }),
}));
import { GET } from "@/app/api/diagnoses/[id]/report/route";
import { POST as auth } from "@/app/api/auth/route";
import { localPaymentEnv } from "./helpers/payment-integration";
async function read() {
  return GET(
    new Request(
      "http://localhost:5208/api/report?checkout=complete&user_id=buyer-a",
    ),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000002" }) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  m.user = { id: "buyer-a", email_confirmed_at: "2026-01-01" };
  m.cookie = true;
  m.payment = { status: "paid", is_test: true };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture");
});
afterEach(() => vi.unstubAllEnvs());
it("report API uses real owned() logic and returns the buyer's paid report", async () => {
  const r = await read();
  expect(r.status).toBe(200);
  expect((await r.json()).report).toEqual({ synthetic: true });
});
it.each(["pending", "failed", "refunded"])(
  "success URL cannot grant access for %s",
  async (status) => {
    m.payment.status = status;
    expect((await read()).status).toBe(403);
    expect(m.reports).not.toHaveBeenCalled();
  },
);
it("other confirmed account cannot override ownership through query parameters", async () => {
  m.user!.id = "buyer-b";
  expect((await read()).status).toBe(404);
  expect(m.reports).not.toHaveBeenCalled();
});
it.each(["absent", "invalid", "unconfirmed"])(
  "%s authentication grants no report",
  async (kind) => {
    if (kind === "absent") m.cookie = false;
    if (kind === "invalid") m.user = null;
    if (kind === "unconfirmed") m.user!.email_confirmed_at = null;
    expect((await read()).status).toBe(401);
    expect(m.reports).not.toHaveBeenCalled();
  },
);
it("local verification blocks signup/reset/resend before Auth or rate-limit writes", async () => {
  localPaymentEnv();
  for (const action of ["signup", "reset", "resend"]) {
    const r = await auth(
      new Request("http://localhost:5208/api/auth", {
        method: "POST",
        headers: { origin: "http://localhost:5208" },
        body: JSON.stringify({
          action,
          email: "synthetic@example.invalid",
          password: "Synthetic-Only42!",
          consent: true,
        }),
      }),
    );
    expect(r.status).toBe(403);
  }
});
