import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyIsolation, isolatedDb } from "./helpers/isolated-db";
import { owns } from "../src/lib/security";

const owner = "00000000-0000-4000-8000-000000000011";
const stranger = "00000000-0000-4000-8000-000000000012";
let pg: PGlite;
let diagnosis: string;
let payment: string;
let before: unknown;
async function snapshot() {
  return (
    await pg.query(`select jsonb_build_object(
    'payments',(select jsonb_agg(to_jsonb(p)-'price_version' order by id) from payments p),
    'diagnoses',(select jsonb_agg(to_jsonb(d) order by id) from diagnoses d),
    'reports',(select jsonb_agg(to_jsonb(r) order by id) from paid_reports r),
    'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p
      where tablename in ('payments','diagnoses','paid_reports'))
  ) data`)
  ).rows;
}
async function rollback(fn: () => Promise<void>) {
  await pg.exec("begin");
  try {
    await fn();
  } finally {
    await pg.exec("rollback");
  }
}
beforeAll(async () => {
  pg = await isolatedDb();
  await pg.query(
    "insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())",
    [owner, stranger],
  );
  // Twelve synthetic purchases, including the reported 2026-10-08 legacy shape.
  for (let i = 0; i < 12; i++) {
    const d = (
      await pg.query<{ id: string }>(
        `insert into diagnoses
      (user_id,anonymous_session_id,diagnosis_type_id,status,question_flow_version)
      values($1,'legacy-fixture',(select id from diagnosis_types limit 1),'report_ready','v1') returning id`,
        [owner],
      )
    ).rows[0].id;
    const p = (
      await pg.query<{ id: string }>(
        `insert into payments
      (diagnosis_id,user_id,status,amount,created_at,paid_at)
      values($1,$2,'paid',980,'2026-10-08T00:00:00Z','2026-10-08T00:00:00Z') returning id`,
        [d, i === 0 ? null : owner],
      )
    ).rows[0].id;
    await pg.query(
      `insert into paid_reports(diagnosis_id,payment_id,status,report_json)
      values($1,$2,'ready','{"preserved":true}')`,
      [d, p],
    );
    if (i === 0) {
      diagnosis = d;
      payment = p;
    }
  }
  before = await snapshot();
  await applyIsolation(pg);
}, 30000);
afterAll(async () => {
  await pg?.close();
});

describe("migration-time legacy purchase with no payment owner or Stripe IDs", () => {
  it("preserves all twelve purchases, diagnoses, reports and ownership policies", async () => {
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await pg.query(
          "select count(*)::int n from payment_legacy_owner_exceptions",
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("allows timestamp-only updates without assigning a purchaser", async () => {
    await rollback(async () => {
      await pg.exec("set local role service_role");
      await pg.query(
        "update payments set updated_at=updated_at+interval '1 second' where id=$1",
        [payment],
      );
      expect(
        (
          await pg.query(
            "select user_id,status,stripe_checkout_session_id,stripe_payment_intent_id from payments where id=$1",
            [payment],
          )
        ).rows[0],
      ).toEqual({
        user_id: null,
        status: "paid",
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
      });
    });
  });
  it("keeps existing report RLS and application ownership checks for the diagnosis owner", async () => {
    // Supabase supplies table grants; the local harness explicitly supplies SELECT.
    await pg.exec(
      "grant select on diagnoses,payments,paid_reports to authenticated",
    );
    for (const who of [owner, stranger]) {
      await rollback(async () => {
        await pg.query("select set_config('request.jwt.claim.sub',$1,true)", [
          who,
        ]);
        await pg.exec("set local role authenticated");
        expect(
          (await pg.query("select id from payments where id=$1", [payment]))
            .rows,
        ).toHaveLength(who === owner ? 1 : 0);
        expect(
          (
            await pg.query(
              "select report_json from paid_reports where payment_id=$1",
              [payment],
            )
          ).rows,
        ).toEqual(who === owner ? [{ report_json: { preserved: true } }] : []);
      });
      expect(
        owns(
          { user_id: owner, anonymous_session_id: "legacy-fixture" },
          "legacy-fixture",
          who,
        ),
      ).toBe(who === owner);
    }
    expect(
      owns(
        { user_id: owner, anonymous_session_id: "legacy-fixture" },
        "legacy-fixture",
        null,
      ),
    ).toBe(false);
  });
  it("does not regenerate ready reports and still supports the existing report retry RPCs", async () => {
    await rollback(async () => {
      await pg.exec("set local role service_role");
      expect(
        (
          await pg.query("select * from claim_report($1,$2)", [
            diagnosis,
            stranger,
          ])
        ).rows,
      ).toHaveLength(0);
      await pg.query(
        "update paid_reports set status='failed' where payment_id=$1",
        [payment],
      );
      expect(
        (
          await pg.query("select * from claim_report($1,$2)", [
            diagnosis,
            stranger,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await pg.query(
            "select finish_report($1,$2,'{\"retried\":true}','fixture','fixture') ok",
            [diagnosis, stranger],
          )
        ).rows,
      ).toEqual([{ ok: true }]);
      expect(
        (await pg.query("select user_id from payments where id=$1", [payment]))
          .rows,
      ).toEqual([{ user_id: null }]);
    });
  });
  it.each([
    "user_id='00000000-0000-4000-8000-000000000012'",
    "amount=1980",
    "status='refunded'",
    "status='failed'",
    "is_test=false",
    "stripe_checkout_session_id='cs_fabricated'",
    "stripe_payment_intent_id='pi_fabricated'",
    "stripe_customer_id='cus_fabricated'",
    "paid_at=now()",
    "created_at=now()",
    "price_version='report-2026-10-980'",
    "id=gen_random_uuid()",
  ])("does not grandfather changed purchase data: %s", async (assignment) => {
    await rollback(async () => {
      await pg.exec("set local role service_role");
      await expect(
        pg.query(`update payments set ${assignment} where id=$1`, [payment]),
      ).rejects.toThrow();
    });
  });
  it("does not permit newly inserted owner mismatches", async () => {
    await rollback(async () => {
      const d = (
        await pg.query<{ id: string }>(
          "insert into diagnoses(user_id,anonymous_session_id,diagnosis_type_id) values($1,'new',(select id from diagnosis_types limit 1)) returning id",
          [owner],
        )
      ).rows[0].id;
      await pg.exec("set local role service_role");
      await expect(
        pg.query(
          "insert into payments(diagnosis_id,user_id,amount,status) values($1,null,980,'paid')",
          [d],
        ),
      ).rejects.toThrow("diagnosis owner mismatch");
    });
  });
  it("does not grandfather a mismatch introduced after migration", async () => {
    await rollback(async () => {
      const d = (
        await pg.query<{ id: string }>(
          "insert into diagnoses(anonymous_session_id,diagnosis_type_id) values('new',(select id from diagnosis_types limit 1)) returning id",
        )
      ).rows[0].id;
      await pg.query(
        "insert into payments(diagnosis_id,amount,status) values($1,980,'paid')",
        [d],
      );
      await pg.query(
        "update diagnoses set user_id=$1,status='report_ready' where id=$2",
        [owner, d],
      );
      await expect(
        pg.query("update payments set updated_at=now() where diagnosis_id=$1", [
          d,
        ]),
      ).rejects.toThrow("diagnosis owner mismatch");
    });
  });
  it("invalidates the exception if the diagnosis owner changes", async () => {
    await rollback(async () => {
      await pg.query("update diagnoses set user_id=$1 where id=$2", [
        stranger,
        diagnosis,
      ]);
      await expect(
        pg.query("update payments set updated_at=now() where id=$1", [payment]),
      ).rejects.toThrow("diagnosis owner mismatch");
    });
  });
  it("preserves the existing explicit account claim path without running it during migration", async () => {
    await rollback(async () => {
      await pg.query("select claim_anonymous_diagnoses($1,'legacy-fixture')", [
        owner,
      ]);
      expect(
        (await pg.query("select user_id from payments where id=$1", [payment]))
          .rows,
      ).toEqual([{ user_id: owner }]);
      await expect(
        pg.query("update payments set user_id=null where id=$1", [payment]),
      ).rejects.toThrow("ownership or settled price immutable");
    });
  });
  it.each([
    "update payment_legacy_owner_exceptions set diagnosis_owner_id=gen_random_uuid()",
    "delete from payment_legacy_owner_exceptions",
    "truncate payment_legacy_owner_exceptions",
  ])(
    "prevents the application from modifying the frozen snapshot: %s",
    async (sql) => {
      await rollback(async () => {
        await pg.exec("set local role service_role");
        await expect(pg.exec(sql)).rejects.toThrow("permission denied");
      });
    },
  );
  it.each(["anon", "authenticated"])(
    "keeps snapshot identities hidden from %s",
    async (role) => {
      await rollback(async () => {
        await pg.exec(`set local role ${role}`);
        await expect(
          pg.exec("select * from payment_legacy_owner_exceptions"),
        ).rejects.toThrow("permission denied");
      });
    },
  );
  it.each(["anon", "authenticated", "service_role"])(
    "prevents %s from adding an exception",
    async (role) => {
      await rollback(async () => {
        await pg.exec(`set local role ${role}`);
        await expect(
          pg.exec(
            "insert into payment_legacy_owner_exceptions select * from payment_legacy_owner_exceptions",
          ),
        ).rejects.toThrow("permission denied");
      });
    },
  );
  it("rolls back unverified refund state and receipt rather than inventing Stripe bindings", async () => {
    await rollback(async () => {
      await pg.exec("savepoint refund_attempt");
      await expect(
        pg.query(
          "select apply_stripe_event_v2('evt_unverified','charge.refunded','hash','cs_fake','pi_fake',$1,980,'jpy','refunded',true,null)",
          [payment],
        ),
      ).rejects.toThrow("diagnosis owner mismatch");
      await pg.exec("rollback to savepoint refund_attempt");
      expect(
        (
          await pg.query("select status,user_id from payments where id=$1", [
            payment,
          ])
        ).rows,
      ).toEqual([{ status: "paid", user_id: null }]);
      expect(
        (
          await pg.query(
            "select * from stripe_events where stripe_event_id='evt_unverified'",
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await pg.query(
            "select status from paid_reports where payment_id=$1",
            [payment],
          )
        ).rows,
      ).toEqual([{ status: "ready" }]);
    });
  });
});
