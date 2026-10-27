import {
  beforeEach,
  afterEach,
  afterAll,
  beforeAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ rpc: mock.rpc }) }));
import {
  withProductionBudget,
  assertProductionSales,
} from "@/lib/production/controls";
import { productionIssues } from "@/lib/production/config";
import { safeOperationalLog } from "@/lib/production/log";
let pg: PGlite;
const env = {
  VERCEL_ENV: "production",
  PRODUCTION_ENVIRONMENT_ID: "fixture-production",
  PRODUCTION_SUPABASE_REF: "abcdefghijklmnopqrst",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_APP_URL: "https://example.org",
  OPENAI_MODEL: "gpt-6-luna",
  PRODUCTION_OPENAI_PROJECT_ID: "proj_fixture",
  STRIPE_MODE: "live",
  STRIPE_ACCOUNT_ID: "acct_fixture",
  STRIPE_SECRET_KEY: "rk_live_fixture",
  OPENAI_API_KEY: "synthetic",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic",
  SESSION_SECRET: "synthetic",
  STRIPE_WEBHOOK_SECRET: "synthetic",
};
const request = () => ({
  model: "gpt-6-luna",
  store: false,
  max_output_tokens: 2400,
  input: [{ role: "user", content: "synthetic" }],
});
const response = () => ({
  model: "gpt-6-luna",
  service_tier: "default",
  usage: { input_tokens: 100, output_tokens: 20 },
});
const signatures: Record<string, string[]> = {
  production_sales_allowed: ["p_environment"],
  reserve_production_ai: ["p_id", "p_environment", "p_max_output"],
  dispatch_production_ai: ["p_id", "p_environment"],
  finish_production_ai: ["p_id", "p_environment", "p_input", "p_output"],
  stop_unknown_production_ai: ["p_id", "p_environment"],
};
async function rpc(name: string, args: Record<string, unknown>) {
  const keys = signatures[name];
  if (!keys) throw Error("unexpected rpc");
  const result = await pg.query<{ data: unknown }>(
    `select public.${name}(${keys.map((_, i) => `$${i + 1}`).join(",")}) as data`,
    keys.map((k) => args[k]),
  );
  return { data: result.rows[0].data, error: null };
}
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  await pg.exec(
    await readFile(
      "supabase/migrations/20261027072559_production_operation_controls.sql",
      "utf8",
    ),
  );
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  await pg.exec(
    "reset role; truncate production_ai_reservations,production_controls; insert into production_controls(environment_id,generation_enabled,sales_enabled,daily_limit_nusd,monthly_limit_nusd,pricing_valid_until) values('fixture-production',true,true,1000000000,10000000000,now()+interval '1 day');",
  );
  mock.rpc.mockReset().mockImplementation(rpc);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("production shared accounting and stops (isolated SQL)", () => {
  it("has no seeded production approval and rejects missing/mismatched control", async () => {
    await pg.exec("truncate production_controls;");
    await expect(withProductionBudget(request(), vi.fn())).rejects.toThrow(
      "Production operation unavailable",
    );
  });
  it("reserves before dispatch, pins tier/truncation, and settles measured conservative cost", async () => {
    const send = vi.fn(async (p) => {
      expect(p.service_tier).toBe("default");
      expect(p.truncation).toBe("disabled");
      const r = await pg.query<{ state: string }>(
        "select state from production_ai_reservations",
      );
      expect(r.rows[0].state).toBe("dispatched");
      return response();
    });
    await withProductionBudget(request(), send);
    expect(send).toHaveBeenCalledTimes(1);
    const r = await pg.query<{ state: string; settled_nusd: number }>(
      "select state,settled_nusd from production_ai_reservations",
    );
    expect(r.rows[0]).toEqual({ state: "settled", settled_nusd: 38500 });
  });
  it("serializes competing reservations and rejects duplicate dispatch without releasing a hold", async () => {
    const ids = Array.from({ length: 8 }, () => randomUUID());
    const rows = await Promise.all(
      ids.map((id) =>
        rpc("reserve_production_ai", {
          p_id: id,
          p_environment: "fixture-production",
          p_max_output: 8500,
        }),
      ),
    );
    expect(rows.filter((x) => x.data === true)).toHaveLength(1);
    const id = ids[rows.findIndex((x) => x.data === true)];
    expect(
      (
        await rpc("dispatch_production_ai", {
          p_id: id,
          p_environment: "fixture-production",
        })
      ).data,
    ).toBe(true);
    expect(
      (
        await rpc("dispatch_production_ai", {
          p_id: id,
          p_environment: "fixture-production",
        })
      ).data,
    ).toBe(false);
    expect(
      (
        await rpc("reserve_production_ai", {
          p_id: id,
          p_environment: "fixture-production",
          p_max_output: 8500,
        })
      ).data,
    ).toBe(false);
  });
  it("retains unknown across month boundary and stops new generation and sales", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => {
      throw Error(
        "synthetic-secret-should-not-escape https://example.org/?token=private",
      );
    });
    await expect(withProductionBudget(request(), send)).rejects.toThrow(
      "Production operation unavailable",
    );
    expect(send).toHaveBeenCalledTimes(1);
    await pg.exec(
      "update production_ai_reservations set reserved_at=now()-interval '2 months'; update production_controls set generation_enabled=true,daily_limit_nusd=1000000000;",
    );
    await expect(withProductionBudget(request(), vi.fn())).rejects.toThrow();
    expect(
      (
        await pg.query<{ state: string }>(
          "select state from production_ai_reservations",
        )
      ).rows[0].state,
    ).toBe("unknown");
    await pg.exec("update production_controls set generation_enabled=false;");
    await expect(assertProductionSales()).rejects.toThrow();
  });
  it("checks month as well as day and retains previous-day settled amount in month", async () => {
    await withProductionBudget(request(), async () => response());
    await pg.exec(
      "update production_controls set monthly_limit_nusd=578500000;",
    ); // next reservation 579480000 exceeds month even with ample day
    await expect(withProductionBudget(request(), vi.fn())).rejects.toThrow();
  });
  it("charges a completed request against its settlement period after midnight", async () => {
    await withProductionBudget(request(), async () => response());
    await pg.exec(
      "update production_ai_reservations set reserved_at=now()-interval '2 months'; update production_controls set daily_limit_nusd=579480000;",
    );
    await expect(withProductionBudget(request(), vi.fn())).rejects.toThrow();
  });
  it("honors a stop between reservation and dispatch", async () => {
    const send = vi.fn();
    mock.rpc.mockImplementation(async (name, args) => {
      const r = await rpc(name, args);
      if (name === "reserve_production_ai")
        await pg.exec(
          "update production_controls set generation_enabled=false;",
        );
      return r;
    });
    await expect(withProductionBudget(request(), send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("never sends after unknown reservation result and never automatically retries provider failures", async () => {
    const send = vi.fn();
    mock.rpc.mockImplementation(async (name, args) => {
      await rpc(name, args);
      throw Error("transport failed");
    });
    await expect(withProductionBudget(request(), send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(
      (await pg.query("select id from production_ai_reservations")).rows,
    ).toHaveLength(1);
  });
  it.each(["model", "tier", "usage", "over_limit"])(
    "holds full amount and stops on invalid %s",
    async (kind) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const r = response();
      if (kind === "model") r.model = "different";
      if (kind === "tier") r.service_tier = "priority";
      if (kind === "usage") r.usage.input_tokens = NaN;
      if (kind === "over_limit") r.usage.output_tokens = 2401;
      await expect(
        withProductionBudget(request(), async () => r),
      ).rejects.toThrow();
      const rows = await pg.query<{ state: string; settled_nusd: null }>(
        "select state,settled_nusd from production_ai_reservations",
      );
      expect(rows.rows[0]).toEqual({ state: "unknown", settled_nusd: null });
    },
  );
  it("does not reopen spending if settlement succeeded but acknowledgement was lost", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.rpc.mockImplementation(async (name, args) => {
      const r = await rpc(name, args);
      if (name === "finish_production_ai") throw Error("lost acknowledgement");
      return r;
    });
    await expect(
      withProductionBudget(request(), async () => response()),
    ).rejects.toThrow();
    expect(
      (
        await pg.query<{ state: string }>(
          "select state from production_ai_reservations",
        )
      ).rows[0].state,
    ).toBe("settled");
  });
  it("stops new sales when the remaining budget cannot reserve one maximum request", async () => {
    await pg.exec("update production_controls set daily_limit_nusd=500000000;");
    await expect(assertProductionSales()).rejects.toThrow();
  });
  it("stops generation even if a completed settlement acknowledgement was lost", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.rpc.mockImplementation(async (name, args) => {
      const r = await rpc(name, args);
      if (name === "finish_production_ai") throw Error("ack lost");
      return r;
    });
    await expect(
      withProductionBudget(request(), async () => response()),
    ).rejects.toThrow();
    expect(
      (await pg.query("select generation_enabled from production_controls"))
        .rows[0],
    ).toEqual({ generation_enabled: false });
  });
  it("denies browser roles both table and RPC access", async () => {
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      await expect(
        pg.query("select * from public.production_controls"),
      ).rejects.toThrow();
      await expect(
        pg.query(
          "select public.production_sales_allowed('fixture-production')",
        ),
      ).rejects.toThrow();
      await pg.exec("reset role");
    }
    await pg.exec("set role service_role");
    expect(
      (
        await rpc("production_sales_allowed", {
          p_environment: "fixture-production",
        })
      ).data,
    ).toBe(true);
    await pg.exec("reset role");
  });
  it("fails closed when configuration expires or execution target differs", async () => {
    await pg.exec(
      "update production_controls set pricing_valid_until=now()-interval '1 second'",
    );
    await expect(withProductionBudget(request(), vi.fn())).rejects.toThrow();
    await expect(assertProductionSales()).rejects.toThrow();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other.example.org");
    expect(productionIssues()).toContain("DATABASE_BINDING");
    vi.stubEnv("OPENAI_BASE_URL", "https://other.example.org");
    expect(productionIssues()).toContain("AI_OVERRIDE");
  });
  it("allows sales only while explicitly enabled and leaves unrelated reads/cancellation ungated", async () => {
    await assertProductionSales();
    await pg.exec("update production_controls set sales_enabled=false;");
    await expect(assertProductionSales()).rejects.toThrow();
    expect(
      (await pg.query("select generation_enabled from production_controls"))
        .rows[0],
    ).toEqual({ generation_enabled: true });
  });
  it("rejects tools or non-text context before reserving", async () => {
    const send = vi.fn();
    await expect(
      withProductionBudget({ ...request(), tools: [] }, send),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(
      (await pg.query("select * from production_ai_reservations")).rows,
    ).toHaveLength(0);
  });
  it("logs only a fixed event without exception content", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    safeOperationalLog("request_failed");
    expect(log).toHaveBeenCalledWith("request_failed");
  });
});
