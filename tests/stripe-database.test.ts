import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { isolatedDb, applyIsolation } from "./helpers/isolated-db";
let pg: PGlite;
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
let legacy: string, current: string;
let baseline: unknown;
async function row(sql: string, args: unknown[] = []) {
  return (await pg.query<Record<string, unknown>>(sql, args)).rows[0];
}
async function purchase(
  amount = 980,
  session: string | null = "cs_test_fixture",
) {
  const d = await row(
    "insert into diagnoses(anonymous_session_id,diagnosis_type_id,user_id) values('fixture',(select id from diagnosis_types limit 1),$1) returning id",
    [user],
  );
  return String(
    (
      await row(
        "insert into payments(diagnosis_id,user_id,amount,stripe_checkout_session_id) values($1,$2,$3,$4) returning id",
        [d.id, user, amount, session],
      )
    ).id,
  );
}
async function apply(
  id: string,
  event: string,
  state = "paid",
  intent: string | null = "pi_fixture",
  session: string | null = "cs_test_fixture",
  amount = 980,
  isTest = true,
) {
  return row(
    "select apply_stripe_event_v2($1,$2,'hash',$3,$4,$5,$6,'jpy',$7,$8,null) result",
    [
      event,
      state === "paid"
        ? "checkout.session.completed"
        : state === "failed"
          ? "payment_intent.payment_failed"
          : "charge.refunded",
      session,
      intent,
      id,
      amount,
      state,
      isTest,
    ],
  );
}
beforeAll(async () => {
  pg = await isolatedDb();
  await pg.query(
    "insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())",
    [user, other],
  );
  await pg.exec(
    "update price_versions set stripe_price_id=case kind when 'plus' then 'price_test_plus' else 'price_test_report' end,active=true;",
  );
  legacy = await purchase(1980, "cs_legacy");
  current = await purchase();
  await pg.query(
    "select apply_stripe_event('evt_legacy','checkout.session.completed','hash','cs_legacy','pi_legacy',$1,1980,'jpy','paid')",
    [legacy],
  );
  await pg.query(
    "update paid_reports set status='ready',report_json='{\"preserved\":true}' where payment_id=$1",
    [legacy],
  );
  await pg.query(
    "insert into billing_customers(user_id,stripe_customer_id) values($1,'cus_existing')",
    [user],
  );
  await pg.query(
    `insert into subscriptions(id,user_id,stripe_customer_id,price_version,amount,status,period_start,period_end,paid_through,cancel_at_period_end,created_at) values('sub_existing',$1,'cus_existing','plus-2026-10-980',980,'active',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days',true,now())`,
    [user],
  );
  await pg.query(
    `insert into subscription_invoices(id,subscription_id,user_id,amount,status,currency,paid_at,period_start,period_end,created_at) values('in_existing','sub_existing',$1,980,'paid','jpy',now(),now()-interval '1 day',now()+interval '29 days',now())`,
    [user],
  );
  baseline = (
    await pg.query("select to_jsonb(p) data from payments p order by id")
  ).rows;
  await applyIsolation(pg);
}, 30000);
afterAll(async () => {
  await pg?.close();
});
describe("isolated PostgreSQL migration and payment transactions", () => {
  it("preserves every existing purchase field and old report", async () => {
    const after = (
      await pg.query(
        "select to_jsonb(p)-'price_version' data from payments p order by id",
      )
    ).rows;
    expect(after).toEqual(baseline);
    expect(
      (
        await row("select report_json from paid_reports where payment_id=$1", [
          legacy,
        ])
      ).report_json,
    ).toEqual({ preserved: true });
  });
  it("keeps Sandbox prices and registers inactive separate Live prices", async () => {
    const r = await pg.query<{ is_test: boolean }>(
      "select kind,is_test,active,stripe_price_id from price_versions order by id",
    );
    expect(r.rows).toHaveLength(4);
    expect(r.rows.filter((x) => x.is_test)).toHaveLength(2);
    await expect(
      pg.exec("update price_versions set active=true where not is_test"),
    ).rejects.toThrow("active catalog environment mismatch");
  });
  it("rejects relabeling a populated DB and immutable prices", async () => {
    await expect(
      pg.exec("update payment_environment set mode='live'"),
    ).rejects.toThrow("empty project");
    await expect(
      pg.exec(
        "update price_versions set amount=100 where id='report-2026-10-980'",
      ),
    ).rejects.toThrow("new price version");
  });
  it("allows retries after a failed attempt without pinning its intent", async () => {
    await apply(current, "evt_failed", "failed", "pi_failed");
    expect(
      (
        await row("select stripe_payment_intent_id from payments where id=$1", [
          current,
        ])
      ).stripe_payment_intent_id,
    ).toBe(null);
    await apply(current, "evt_paid", "paid", "pi_fixture");
    expect(
      (await row("select status from payments where id=$1", [current])).status,
    ).toBe("paid");
  });
  it("deduplicates notifications and ignores late failure", async () => {
    expect((await apply(current, "evt_paid")).result).toBe(false);
    await apply(current, "evt_late_failed", "failed", "pi_failed");
    expect(
      (await row("select status from payments where id=$1", [current])).status,
    ).toBe("paid");
    expect(
      (
        await row(
          "select count(*)::int n from paid_reports where payment_id=$1",
          [current],
        )
      ).n,
    ).toBe(1);
  });
  it("refund is terminal even when success arrives later", async () => {
    await apply(current, "evt_refund", "refunded");
    await apply(current, "evt_late_paid");
    expect(
      (await row("select status from payments where id=$1", [current])).status,
    ).toBe("refunded");
    expect(
      (
        await row("select status from paid_reports where payment_id=$1", [
          current,
        ])
      ).status,
    ).toBe("revoked");
  });
  it("accepts a verified payment before Checkout ID persistence", async () => {
    const id = await purchase(980, null);
    await apply(id, "evt_early", "paid", "pi_early", "cs_early");
    expect(
      await row(
        "select status,stripe_checkout_session_id from payments where id=$1",
        [id],
      ),
    ).toMatchObject({ status: "paid", stripe_checkout_session_id: "cs_early" });
  });
  it("refund before paid event never creates access", async () => {
    const id = await purchase(980, "cs_reverse");
    await apply(
      id,
      "evt_reverse_refund",
      "refunded",
      "pi_reverse",
      "cs_reverse",
    );
    await apply(id, "evt_reverse_paid", "paid", "pi_reverse", "cs_reverse");
    expect(
      (
        await row(
          "select count(*)::int n from paid_reports where payment_id=$1",
          [id],
        )
      ).n,
    ).toBe(0);
  });
  it("rejects mode, amount, intent and event identity mismatches atomically", async () => {
    await expect(
      apply(
        current,
        "evt_bad_mode",
        "paid",
        "pi_fixture",
        "cs_test_fixture",
        980,
        false,
      ),
    ).rejects.toThrow();
    await expect(
      apply(
        current,
        "evt_bad_amount",
        "paid",
        "pi_fixture",
        "cs_test_fixture",
        1,
      ),
    ).rejects.toThrow();
    await expect(
      apply(current, "evt_bad_intent", "paid", "pi_other"),
    ).rejects.toThrow();
    await expect(
      apply(current, "evt_missing_pi", "paid", null),
    ).rejects.toThrow();
    await expect(apply(current, "evt_refund", "paid")).rejects.toThrow(
      "identity collision",
    );
    expect(
      (
        await row(
          "select count(*)::int n from stripe_events where stripe_event_id like 'evt_bad%' or stripe_event_id='evt_missing_pi'",
        )
      ).n,
    ).toBe(0);
  });
  it("rejects purchase reassignment and direct client mutation", async () => {
    await expect(
      pg.query("update payments set user_id=$1 where id=$2", [other, current]),
    ).rejects.toThrow("ownership");
    await pg.exec("set role authenticated");
    await expect(
      pg.exec("update payment_environment set mode='live'"),
    ).rejects.toThrow("permission denied");
    await expect(apply(current, "evt_client")).rejects.toThrow(
      "permission denied",
    );
    await pg.exec("reset role");
  });
  it("runs the legacy Sandbox RPC and existing SQL regression suite", async () => {
    const fresh = await isolatedDb();
    try {
      await applyIsolation(fresh);
      await fresh.exec(await readFile("tests/database.sql", "utf8"));
    } finally {
      await fresh.close();
    }
  });
  it("keeps existing subscription entitlement and cancellation reservation", async () => {
    expect(
      await row(
        "select status,cancel_at_period_end from subscriptions where id='sub_existing'",
      ),
    ).toEqual({ status: "active", cancel_at_period_end: true });
    expect(
      (await row("select consultation_entitlement($1) usage", [user])).usage,
    ).toMatchObject({ plan: "plus", limit: 30 });
  });
  it("subscription snapshots support renewal, failure, cancellation and resubscription", async () => {
    const existing = await row(
      "select * from subscriptions where id='sub_existing'",
    );
    const snapshot = {
      ...existing,
      id: "sub_new",
      cancel_at_period_end: false,
    };
    const invoice = {
      ...(await row(
        "select * from subscription_invoices where id='in_existing'",
      )),
      id: "in_new",
      subscription_id: "sub_new",
    };
    const save = async (
      s: Record<string, unknown>,
      invoices: unknown[],
      event: string,
    ) =>
      pg.query(
        "select apply_subscription_snapshot($1,$2,$3,'invoice.paid','hash')",
        [JSON.stringify(s), JSON.stringify(invoices), event],
      );
    await save(snapshot, [invoice], "evt_subscription_1");
    await save(snapshot, [invoice], "evt_subscription_1");
    expect(
      (
        await row(
          "select count(*)::int n from subscription_invoices where id='in_new'",
        )
      ).n,
    ).toBe(1);
    await save(
      { ...snapshot, status: "past_due", cancel_at_period_end: true },
      [{ ...invoice, status: "open", amount: 0 }],
      "evt_subscription_2",
    );
    expect(
      await row(
        "select status,cancel_at_period_end from subscriptions where id='sub_new'",
      ),
    ).toEqual({ status: "past_due", cancel_at_period_end: true });
    await save(
      { ...snapshot, status: "canceled", paid_through: null },
      [invoice],
      "evt_subscription_3",
    );
    await save(
      { ...snapshot, id: "sub_again" },
      [{ ...invoice, id: "in_again", subscription_id: "sub_again" }],
      "evt_subscription_4",
    );
    expect(
      (await row("select status from subscriptions where id='sub_again'"))
        .status,
    ).toBe("active");
    await expect(
      save({ ...snapshot, is_test: false }, [], "evt_subscription_wrong_mode"),
    ).rejects.toThrow("environment mismatch");
    await pg.query(
      "insert into billing_customers(user_id,stripe_customer_id) values($1,'cus_other')",
      [other],
    );
    await expect(
      save(
        { ...snapshot, user_id: other, stripe_customer_id: "cus_other" },
        [],
        "evt_subscription_wrong_owner",
      ),
    ).rejects.toThrow("identity mismatch");
    await expect(
      save(snapshot, [{ ...invoice, user_id: other }], "evt_wrong_invoice"),
    ).rejects.toThrow("invoice mismatch");
  });
  it("ordinary service-role operations work but environment writes do not", async () => {
    await pg.exec("set role service_role");
    expect((await row("select mode from payment_environment")).mode).toBe(
      "sandbox",
    );
    await pg.exec(
      "update billing_customers set checkout_session_id='cs_customer' where stripe_customer_id='cus_existing'",
    );
    await pg.exec(
      "update price_versions set active=false where id='report-2026-10-980'; update price_versions set active=true where id='report-2026-10-980'",
    );
    await expect(
      pg.exec("update payment_environment set mode='live'"),
    ).rejects.toThrow("permission denied");
    await pg.exec("reset role");
  });
  it("bootstraps only an empty isolated Live DB and rejects Sandbox finance", async () => {
    const live = await isolatedDb();
    try {
      await applyIsolation(live);
      await live.exec(
        await readFile("supabase/review/initialize-empty-live.sql", "utf8"),
      );
      expect(
        (await live.query("select mode from payment_environment")).rows[0],
      ).toEqual({ mode: "live" });
      expect(
        (
          await live.query(
            "select count(*)::int n from price_versions where active and not is_test",
          )
        ).rows[0],
      ).toEqual({ n: 2 });
      await expect(
        live.exec("update price_versions set active=true where is_test"),
      ).rejects.toThrow("environment mismatch");
      await live.query("insert into auth.users(id) values($1)", [user]);
      await expect(
        live.exec("update payment_environment set mode='sandbox'"),
      ).rejects.toThrow("empty project");
      await live.query(
        "insert into billing_customers(user_id,stripe_customer_id,is_test) values($1,'cus_live',false)",
        [user],
      );
      await expect(
        live.query(
          "update billing_customers set is_test=true where user_id=$1",
          [user],
        ),
      ).rejects.toThrow("environment mismatch");
      await expect(
        live.query(
          "select apply_stripe_event('evt_legacy','checkout.session.completed','hash','cs','pi',$1,980,'jpy','paid')",
          [user],
        ),
      ).rejects.toThrow("Sandbox only");
    } finally {
      await live.close();
    }
  });
  it("partial state blocks migration and rolls back its attempted changes", async () => {
    const partial = await isolatedDb();
    try {
      await partial.exec("alter table payments add column price_version text");
      await expect(applyIsolation(partial)).rejects.toThrow(
        "partially applied",
      );
      await partial.exec("rollback");
      expect(
        (
          await partial.query(
            "select to_regclass('public.payment_environment') present",
          )
        ).rows[0],
      ).toEqual({ present: null });
    } finally {
      await partial.close();
    }
  });
  it("a failure late in the migration rolls back schema and catalog changes", async () => {
    const fresh = await isolatedDb();
    try {
      const sql = await readFile(
        "supabase/migrations/20261013074636_stripe_environment_isolation.sql",
        "utf8",
      );
      await expect(
        fresh.exec(sql.replace("\ncommit;", "\nselect 1/0;\ncommit;")),
      ).rejects.toThrow("division by zero");
      await fresh.exec("rollback");
      expect(
        (
          await fresh.query(
            "select to_regclass('public.payment_legacy_owner_exceptions') present",
          )
        ).rows[0],
      ).toEqual({ present: null });
      expect(
        (
          await fresh.query(
            "select to_regclass('public.payment_environment') present",
          )
        ).rows[0],
      ).toEqual({ present: null });
      expect(
        (await fresh.query("select count(*)::int n from price_versions"))
          .rows[0],
      ).toEqual({ n: 2 });
      await applyIsolation(fresh);
    } finally {
      await fresh.close();
    }
  });
  it("rejects repeat migration without overwriting data", async () => {
    await expect(applyIsolation(pg)).rejects.toThrow(
      "already or partially applied",
    );
    await pg.exec("rollback");
    expect(
      (await row("select count(*)::int n from payment_environment")).n,
    ).toBe(1);
  });
});
