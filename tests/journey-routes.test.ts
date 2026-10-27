import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  owner: null as string | null,
  signedIn: false,
  deny: false,
  queries: [] as { table: string; filters: unknown[] }[],
}));
vi.mock("@/lib/http", () => ({
  api: async (fn: () => unknown) => fn(),
  csrf: () => {},
  rate: () => {},
  body: async (req: Request, schema: { parse: (v: unknown) => unknown }) =>
    schema.parse(await req.json()),
  owned: async () => {
    if (m.deny) throw Object.assign(new Error("denied"), { status: 404 });
    return { user_id: m.owner, status: "ready", question_flow_version: "v1" };
  },
  identity: async () => ({ userId: m.signedIn ? "owner" : null }),
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  checked: (r: { data: unknown }) => r.data,
  db: () => ({
    from: (table: string) => {
      const q = { table, filters: [] as unknown[] };
      m.queries.push(q);
      const data =
        table === "free_reports"
          ? { report_json: { summary: "synthetic" } }
          : table === "payments"
            ? { status: "paid", is_test: true }
            : table === "paid_reports"
              ? {
                  status: "ready",
                  report_json: { synthetic: true },
                  attempts: 1,
                }
              : [];
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve({ data })),
      };
      for (const method of [
        "select",
        "eq",
        "is",
        "limit",
        "maybeSingle",
        "order",
        "neq",
        "ilike",
        "in",
      ])
        chain[method] = (...args: unknown[]) => {
          q.filters.push([method, ...args]);
          return chain;
        };
      return chain;
    },
  }),
}));
vi.mock("@/lib/questions/engine", () => ({ getPublicFlow: vi.fn() }));
vi.mock("@/lib/stripe/environment", () => ({
  paymentEnvironment: async () => ({ isTest: true }),
}));
vi.mock("@/lib/ai/pipeline", () => ({ generatePaid: vi.fn() }));
vi.mock("@/lib/consultation/access", () => ({
  member: async () => "owner",
  ownThread: vi.fn(),
}));
import { GET as diagnosis } from "@/app/api/diagnoses/[id]/route";
import { GET as report } from "@/app/api/diagnoses/[id]/report/route";
import { POST as search } from "@/app/api/consultations/route";
import { POST as events } from "@/app/api/consultation-events/route";
beforeEach(() => {
  m.owner = null;
  m.signedIn = false;
  m.deny = false;
  m.queries = [];
  vi.unstubAllEnvs();
});
it.each([
  [false, null, "anonymous"],
  [true, null, "unsaved"],
  [true, "owner", "saved"],
] as const)(
  "real diagnosis and report routes expose checked save state (%s,%s)",
  async (signedIn, owner, state) => {
    m.signedIn = signedIn;
    m.owner = owner;
    for (const route of [diagnosis, report])
      expect(
        await route(new Request("https://example.test"), {
          params: Promise.resolve({ id: "synthetic" }),
        }),
      ).toMatchObject({ saveState: state });
  },
);
it("denied diagnosis never returns a report or its save state", async () => {
  m.deny = true;
  for (const route of [diagnosis, report])
    await expect(
      route(new Request("https://example.test"), {
        params: Promise.resolve({ id: "other" }),
      }),
    ).rejects.toMatchObject({ status: 404 });
  expect(m.queries).toEqual([]);
});
it("search scopes every source query to verified owner and refuses one-character unbounded searches", async () => {
  const req = (query: string) =>
    new Request("https://example.test/api/consultations", {
      method: "POST",
      body: JSON.stringify({ action: "search", query }),
    });
  await search(req("返信"));
  expect(m.queries.length).toBe(4);
  for (const q of m.queries)
    expect(q.filters).toContainEqual(["eq", "user_id", "owner"]);
  await expect(search(req("a"))).rejects.toBeDefined();
});
it("manual-event write is unavailable before explicit external enablement", async () => {
  vi.stubEnv("CONSULTATION_EVENTS_ENABLED", "false");
  await expect(
    events(
      new Request("https://example.test/api/consultation-events", {
        method: "POST",
        body: "{}",
      }),
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(m.queries).toEqual([]);
});
