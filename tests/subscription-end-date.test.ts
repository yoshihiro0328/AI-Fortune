import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import type Stripe from "stripe";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isolatedDb, applyIsolation } from "./helpers/isolated-db";
import type { ConsultationHome, Subscription } from "@/lib/consultation/model";
import {
  japanDate,
  subscriptionDisplay,
} from "@/lib/consultation/subscription-display";
const m = vi.hoisted(() => ({
  db: vi.fn(),
  retrieve: vi.fn(),
  invoices: vi.fn(),
  home: null as unknown,
}));
vi.mock("@/lib/stripe/environment", () => ({
  stripeEnvironment: async () => ({ mode: "sandbox", isTest: true }),
}));
vi.mock("@/lib/ai/pipeline", () => ({
  lock: async (_key: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: () => ({
    subscriptions: {
      retrieve: m.retrieve,
      list: async () => ({ data: [await m.retrieve()] }),
    },
    invoices: { list: m.invoices },
  }),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("@/lib/supabase/admin")>()),
  db: m.db,
}));
vi.mock("@/lib/consultation/access", () => ({
  member: async () => "00000000-0000-4000-8000-000000000001",
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("@/lib/http")>()),
  rate: async () => undefined,
}));
vi.mock("react", async (original) => {
  const real = await original<typeof import("react")>();
  return {
    ...real,
    useState: (initial: unknown) =>
      real.useState(initial === null ? m.home : initial),
  };
});
import {
  syncSubscription,
  subscriptionFromEvent,
} from "@/lib/stripe/subscriptions";
import { GET as consultationGET } from "@/app/api/consultations/route";
import { GET as billingGET } from "@/app/api/billing/route";
import ConsultationSummary from "@/components/consultation-summary";
const user = "00000000-0000-4000-8000-000000000001";
const migration =
  "supabase/migrations/20261014075838_subscription_ended_at.sql";
const start = 1791962983,
  end = 1794641383,
  ended = 1791963247,
  canceled = 1791963162;
const iso = (n: number) => new Date(n * 1000).toISOString();
let pg: PGlite;
let before: unknown;
// Only the Supabase transport is adapted; application SQL/RPC, sync, routes and UI run unchanged.
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function from(table: string) {
  let columns = "*",
    suffix = "";
  const where: string[] = [],
    args: unknown[] = [];
  const q = {
    select(value: string) {
      columns = value;
      return q;
    },
    eq(key: string, value: unknown) {
      args.push(value);
      where.push(`${key}=$${args.length}`);
      return q;
    },
    neq(key: string, value: unknown) {
      args.push(value);
      where.push(`${key}<>$${args.length}`);
      return q;
    },
    order(key: string, opts: { ascending: boolean }) {
      suffix += ` order by ${key} ${opts.ascending ? "asc" : "desc"}`;
      return q;
    },
    limit(n: number) {
      suffix += ` limit ${n}`;
      return q;
    },
    async execute() {
      const result = await pg.query(
        `select ${columns} from ${table}${where.length ? " where " + where.join(" and ") : ""}${suffix}`,
        args,
      );
      return { data: json(result.rows), error: null };
    },
    async maybeSingle() {
      const result = await q.execute();
      return { data: result.data[0] ?? null, error: null };
    },
    then(
      resolve: (value: unknown) => unknown,
      reject: (error: unknown) => unknown,
    ) {
      return q.execute().then(resolve, reject);
    },
  };
  return q;
}
async function rpc(name: string, args: Record<string, unknown>) {
  if (name === "consultation_entitlement")
    return {
      data: (
        await pg.query<{ value: unknown }>(
          "select consultation_entitlement($1) value",
          [args.p_user],
        )
      ).rows[0].value,
      error: null,
    };
  if (name !== "apply_subscription_snapshot") throw new Error("Unexpected RPC");
  await pg.query("select apply_subscription_snapshot($1,$2,$3,$4,$5)", [
    JSON.stringify(args.p_snapshot),
    JSON.stringify(args.p_invoices),
    args.p_event,
    args.p_type,
    args.p_hash,
  ]);
  return { data: null, error: null };
}
function stripeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_fixture",
    customer: "cus_fixture",
    metadata: { user_id: user },
    livemode: false,
    status: "active",
    created: start,
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: start,
          current_period_end: end,
          price: {
            id: "price_fixture",
            product: "yorisoi_plus_202610",
            livemode: false,
            currency: "jpy",
            unit_amount: 980,
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
    ...overrides,
  };
}
async function home() {
  const response = await consultationGET(
    new Request("https://fixture.invalid/api/consultations"),
  );
  expect(response.status).toBe(200);
  const data = (await response.json()) as ConsultationHome;
  m.home = data;
  return {
    data,
    html: renderToStaticMarkup(createElement(ConsultationSummary)),
  };
}
async function saved() {
  return json(
    (
      await pg.query<Subscription>(
        "select * from subscriptions where id='sub_fixture'",
      )
    ).rows[0],
  );
}
async function deliver(type: string, id = type) {
  const event = {
    type,
    data: {
      object: {
        id: "sub_fixture",
        status: type.endsWith("created") ? "active" : "canceled",
        ended_at: null,
      },
    },
  } as unknown as Stripe.Event;
  await syncSubscription((await subscriptionFromEvent(event))!, {
    id,
    type,
    hash: id,
  });
}
async function snapshot() {
  return (
    await pg.query(
      `select jsonb_build_object('payments',(select jsonb_agg(to_jsonb(p)) from payments p),'reports',(select jsonb_agg(to_jsonb(r)) from paid_reports r),'diagnoses',(select jsonb_agg(to_jsonb(d)) from diagnoses d),'subscriptions',(select jsonb_agg(to_jsonb(s)-'ended_at') from subscriptions s),'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p)) value`,
    )
  ).rows;
}
beforeAll(async () => {
  pg = await isolatedDb();
  await pg.query(
    "insert into auth.users(id,email_confirmed_at) values($1,now())",
    [user],
  );
  await pg.exec(
    "update price_versions set stripe_price_id='price_fixture' where kind='plus'",
  );
  await pg.query(
    "insert into billing_customers(user_id,stripe_customer_id) values($1,'cus_fixture')",
    [user],
  );
  await pg.query(
    `insert into diagnoses(id,user_id,anonymous_session_id,diagnosis_type_id,status) values('00000000-0000-4000-8000-000000000011',$1,'fixture',(select id from diagnosis_types limit 1),'report_ready')`,
    [user],
  );
  await pg.query(
    `insert into payments(id,diagnosis_id,user_id,amount,status) values('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000011',$1,1980,'paid')`,
    [user],
  );
  await pg.exec(`insert into paid_reports(diagnosis_id,payment_id,status,report_json) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','ready','{"legacy":true}');
    grant select on diagnoses,payments,paid_reports,subscriptions to authenticated;`);
  await applyIsolation(pg);
  // Existing ended records remain unknown after migration; no date is backfilled.
  await pg.query(
    `insert into subscriptions(id,user_id,stripe_customer_id,price_version,amount,status,period_start,period_end,created_at,canceled_at) values('sub_old',$1,'cus_fixture','plus-2026-10-980',980,'canceled',$2,$3,$2,$2)`,
    [user, iso(start - 100), iso(end)],
  );
  before = await snapshot();
  await pg.exec(await readFile(migration, "utf8"));
  m.db.mockReturnValue({ from, rpc });
}, 30000);
beforeEach(async () => {
  await pg.exec("begin");
  m.retrieve.mockResolvedValue(stripeSub());
  m.invoices.mockResolvedValue({ data: [] });
});
afterEach(async () => {
  await pg.exec("rollback");
  m.home = null;
});
afterAll(async () => {
  await pg?.close();
});

describe("actual subscription end: Stripe → PostgreSQL → APIs → rendered account", () => {
  it("October 14 immediate cancellation never displays November 14 or the earlier cancellation request", async () => {
    m.retrieve.mockResolvedValue(
      stripeSub({ status: "canceled", canceled_at: canceled, ended_at: ended }),
    );
    await deliver("customer.subscription.deleted");
    expect(await saved()).toMatchObject({
      ended_at: iso(ended),
      period_end: iso(end),
    });
    const { data, html } = await home();
    expect(data.usage).toMatchObject({ plan: "free", limit: 3 });
    expect(html).toContain("契約終了日：2026/10/14 16:34:07");
    expect(html).toContain("解約済み");
    expect(html).not.toContain("2026/11/14");
    expect(html).not.toContain("16:32:42");
    expect(html).not.toContain("次回更新日");
    const billing = await billingGET();
    expect(billing.status).toBe(200);
    expect((await billing.json()).subscription.ended_at).toBe(iso(ended));
  });
  it("scheduled cancellation displays the scheduled date", async () => {
    m.retrieve.mockResolvedValue(
      stripeSub({
        cancel_at_period_end: true,
        cancel_at: end,
        canceled_at: canceled,
      }),
    );
    await deliver("customer.subscription.updated");
    const { html } = await home();
    expect(html).toContain("契約終了予定日：2026/11/14 16:29:43");
    expect(html).not.toContain("契約終了日：");
  });
  it("ordinary subscription displays next renewal", async () => {
    await syncSubscription("sub_fixture");
    expect((await home()).html).toContain("次回更新日：2026/11/14 16:29:43");
  });
  it("end of period cancellation prioritizes terminal status over the old reservation flag", async () => {
    m.retrieve.mockResolvedValue(
      stripeSub({
        status: "canceled",
        ended_at: end,
        canceled_at: canceled,
        cancel_at_period_end: true,
        cancel_at: end,
      }),
    );
    await deliver("customer.subscription.deleted");
    const { data, html } = await home();
    expect(data.usage.plan).toBe("free");
    expect(html).toContain("契約終了日：2026/11/14 16:29:43");
    expect(html).not.toContain("解約予約済み");
  });
  it("replayed and reverse-order webhooks keep the latest Stripe state and end timestamp", async () => {
    m.retrieve.mockResolvedValue(
      stripeSub({ status: "canceled", ended_at: ended, canceled_at: canceled }),
    );
    await deliver("customer.subscription.deleted", "evt_deleted");
    const first = await saved();
    await deliver("customer.subscription.deleted", "evt_deleted");
    await deliver("customer.subscription.created", "evt_old_created");
    await deliver("customer.subscription.updated", "evt_old_updated");
    expect(await saved()).toMatchObject({
      status: first.status,
      ended_at: first.ended_at,
      period_end: first.period_end,
    });
    expect((await home()).data.usage.plan).toBe("free");
    expect(
      (
        await pg.query(
          "select * from stripe_events where stripe_event_id='evt_deleted'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("removing a cancellation reservation restores renewal display without using canceled_at", async () => {
    m.retrieve.mockResolvedValue(
      stripeSub({
        cancel_at_period_end: true,
        cancel_at: end,
        canceled_at: canceled,
      }),
    );
    await deliver("customer.subscription.updated", "evt_schedule");
    m.retrieve.mockResolvedValue(stripeSub({ canceled_at: canceled }));
    await deliver("customer.subscription.updated", "evt_resume");
    const { html } = await home();
    expect(html).toContain("次回更新日：2026/11/14");
    expect(html).not.toContain("解約予約済み");
    expect(html).not.toContain("契約終了予定日");
  });
  it.each([null, undefined])(
    "missing ended_at (%s) renders no guessed end date",
    async (value) => {
      m.retrieve.mockResolvedValue(
        stripeSub({
          status: "canceled",
          ended_at: value,
          canceled_at: canceled,
          cancel_at: end,
          cancel_at_period_end: true,
        }),
      );
      await syncSubscription("sub_fixture");
      const { html } = await home();
      expect(html).toContain("解約済み");
      expect(html).not.toContain("契約終了日：");
      expect(html).not.toContain("2026/11/14");
    },
  );
  it("JST date crosses midnight independently of the server/browser timezone", () => {
    for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      vi.stubEnv("TZ", zone);
      expect(japanDate("2026-10-13T15:00:00Z")).toBe("2026/10/14 0:00:00");
      expect(japanDate("2026-10-13T14:59:59Z")).toBe("2026/10/13 23:59:59");
    }
    vi.unstubAllEnvs();
    expect(japanDate("invalid")).toBeNull();
  });
  it("Plus quota remains 30 while paid; termination returns it to free quota 3", async () => {
    const now = Math.floor(Date.now() / 1000),
      sub = stripeSub();
    sub.items.data[0].current_period_start = now - 86400;
    sub.items.data[0].current_period_end = now + 86400;
    m.retrieve.mockResolvedValue(sub);
    m.invoices.mockResolvedValue({
      data: [
        {
          id: "in_fixture",
          livemode: false,
          customer: sub.customer,
          parent: { subscription_details: { subscription: sub.id } },
          currency: "jpy",
          amount_paid: 980,
          total: 980,
          status: "paid",
          created: now - 86400,
          status_transitions: { paid_at: now - 86400 },
          lines: {
            has_more: false,
            data: [
              {
                quantity: 1,
                period: { start: now - 86400, end: now + 86400 },
                pricing: { price_details: { price: "price_fixture" } },
              },
            ],
          },
        },
      ],
    });
    await syncSubscription(sub.id);
    expect((await home()).data.usage).toMatchObject({
      plan: "plus",
      limit: 30,
      remaining: 30,
    });
    m.retrieve.mockResolvedValue({
      ...sub,
      cancel_at_period_end: true,
      cancel_at: now + 86400,
    });
    await syncSubscription(sub.id);
    expect((await home()).data.usage.plan).toBe("plus");
    m.retrieve.mockResolvedValue({ ...sub, status: "canceled", ended_at: now });
    await syncSubscription(sub.id);
    expect((await home()).data.usage).toMatchObject({
      plan: "free",
      limit: 3,
      remaining: 3,
    });
  });
  it("free plan without a current subscription does not display an active Plus contract", async () => {
    await pg.exec("delete from subscriptions");
    const { html } = await home();
    expect(html).toContain("無料プラン");
    expect(html).not.toContain("契約中");
    expect(html).not.toContain("次回更新日");
  });
  it("active DB status without paid entitlement clearly states the current free plan", async () => {
    await syncSubscription("sub_fixture");
    expect((await home()).html).toContain("契約中（現在は無料プラン）");
  });
});

describe("migration and existing purchases", () => {
  it("existing consultation SQL enforces consumption, 3/30 quotas and cancellation after migration", async () => {
    // The existing SQL suite owns its BEGIN/ROLLBACK and uses only synthetic rows.
    await pg.exec("rollback");
    await pg.exec("alter table auth.users add column if not exists email text");
    await pg.exec(await readFile("tests/consultation-database.sql", "utf8"));
    await pg.exec("begin");
  });

  it("preserves every existing field and RLS policy and leaves old end dates NULL", async () => {
    expect(await snapshot()).toEqual(before);
    expect(
      (await pg.query("select ended_at from subscriptions where id='sub_old'"))
        .rows,
    ).toEqual([{ ended_at: null }]);
  });
  it("keeps legacy 1,980 yen report readable only by its owner after a Plus cancellation", async () => {
    m.retrieve.mockResolvedValue(
      stripeSub({ status: "canceled", ended_at: ended }),
    );
    await syncSubscription("sub_fixture");
    for (const who of [user, "00000000-0000-4000-8000-000000000002"]) {
      await pg.query("select set_config('request.jwt.claim.sub',$1,true)", [
        who,
      ]);
      await pg.exec("set local role authenticated");
      expect(
        (await pg.query("select report_json from paid_reports")).rows,
      ).toEqual(who === user ? [{ report_json: { legacy: true } }] : []);
      await pg.exec("reset role");
    }
  });
  it("new 980 yen purchase still grants its report via the existing payment RPC", async () => {
    const d = (
      await pg.query<{ id: string }>(
        "insert into diagnoses(user_id,anonymous_session_id,diagnosis_type_id) values($1,'new',(select id from diagnosis_types limit 1)) returning id",
        [user],
      )
    ).rows[0].id;
    const p = (
      await pg.query<{ id: string }>(
        "insert into payments(diagnosis_id,user_id,amount,stripe_checkout_session_id,price_version) values($1,$2,980,'cs_test_fixture','report-2026-10-980') returning id",
        [d, user],
      )
    ).rows[0].id;
    await pg.query(
      "select apply_stripe_event_v2('evt_paid','checkout.session.completed','hash','cs_test_fixture','pi_fixture',$1,980,'jpy','paid',true,null)",
      [p],
    );
    expect(
      (await pg.query("select status,amount from payments where id=$1", [p]))
        .rows,
    ).toEqual([{ status: "paid", amount: 980 }]);
    expect(
      (
        await pg.query(
          "select payment_id from paid_reports where payment_id=$1",
          [p],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("old application snapshots that omit ended_at cannot erase an already known end", async () => {
    m.retrieve.mockResolvedValue(
      stripeSub({ status: "canceled", ended_at: ended }),
    );
    await syncSubscription("sub_fixture");
    const old = { ...(await saved()) } as Partial<Subscription>;
    delete old.ended_at;
    await rpc("apply_subscription_snapshot", {
      p_snapshot: old,
      p_invoices: [],
      p_event: null,
      p_type: null,
      p_hash: null,
    });
    expect((await saved()).ended_at).toBe(iso(ended));
  });
  it("RPC remains invoker-only with service_role execution and owner RLS", async () => {
    const row = (
      await pg.query(
        `select prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service from pg_proc where proname='apply_subscription_snapshot'`,
      )
    ).rows[0];
    expect(row).toEqual({
      prosecdef: false,
      anon: false,
      authenticated: false,
      service: true,
    });
  });
  it("invalid or missing dates do not invent a display", () => {
    const sub = {
      status: "canceled",
      ended_at: "invalid",
      period_end: iso(end),
      cancel_at: iso(end),
    } as Subscription;
    expect(subscriptionDisplay(sub, "free").date).toBeNull();
  });
});
