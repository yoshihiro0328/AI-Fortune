// Offline PostgreSQL engine; never reads credentials or contacts a hosted database.
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import {
  isolatedDb,
  applyIsolation,
  migrationName,
} from "./helpers/isolated-db";
import { paidSchema } from "@/lib/ai/schemas";
let pg: PGlite;
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
let diagnosis: string, payment: string;
async function apply(event = "evt_paid_fixture") {
  return pg.query(
    "select apply_stripe_event_v2($1,'checkout.session.completed','fixture','cs_fixture','pi_fixture',$2,980,'jpy','paid',true,null) applied",
    [event, payment],
  );
}
async function visible(user: string, table: string) {
  await pg.exec("begin; set local role authenticated;");
  try {
    await pg.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    return (
      await pg.query(`select id from public.${table} where diagnosis_id=$1`, [
        diagnosis,
      ])
    ).rows;
  } finally {
    await pg.exec("rollback");
  }
}
beforeAll(async () => {
  pg = await isolatedDb();
  await applyIsolation(pg);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql") && n > migrationName)
    .sort())
    await pg.exec(await readFile("supabase/migrations/" + name, "utf8"));
  await pg.exec(
    "update payment_environment set stripe_account_id='acct_1UQlQdI73kTcvXz8';",
  );
  await pg.query(
    "insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())",
    [a, b],
  );
  diagnosis = (
    await pg.query<{ id: string }>(
      "insert into diagnoses(user_id,anonymous_session_id,diagnosis_type_id,status) values($1,'synthetic-payment-only',(select id from diagnosis_types limit 1),'free_result_ready') returning id",
      [a],
    )
  ).rows[0].id;
  payment = (
    await pg.query<{ id: string }>(
      "insert into payments(diagnosis_id,user_id,amount,stripe_checkout_session_id) values($1,$2,980,'cs_fixture') returning id",
      [diagnosis, a],
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => pg?.close());
it("before a signed event is applied, pending payment confers no report", async () => {
  expect(await visible(a, "paid_reports")).toEqual([]);
  expect(
    (await pg.query("select status from payments where id=$1", [payment])).rows,
  ).toEqual([{ status: "pending" }]);
});
it("the real transaction creates one queued entitlement for the exact buyer", async () => {
  expect((await apply()).rows).toEqual([{ applied: true }]);
  expect(
    (
      await pg.query(
        "select user_id,status,amount,currency,is_test from payments where id=$1",
        [payment],
      )
    ).rows,
  ).toEqual([
    { user_id: a, status: "paid", amount: 980, currency: "jpy", is_test: true },
  ]);
  expect(
    (
      await pg.query(
        "select status,attempts from paid_reports where payment_id=$1",
        [payment],
      )
    ).rows,
  ).toEqual([{ status: "queued", attempts: 0 }]);
});
it("same event and distinct success events do not grant a second report or payment-completed action", async () => {
  expect((await apply()).rows).toEqual([{ applied: false }]);
  await apply("evt_second_success_fixture");
  expect(
    (
      await pg.query(
        "select count(*)::int n from paid_reports where payment_id=$1",
        [payment],
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
  expect(
    (
      await pg.query(
        "select count(*)::int n from analytics_events where metadata->>'diagnosis_id'=$1 and event_name='payment_completed'",
        [diagnosis],
      )
    ).rows,
  ).toEqual([{ n: 1 }]);
});
it("only a ready synthetic example is visible to buyer A; B sees neither purchase nor report", async () => {
  const report = paidSchema.parse(
    JSON.parse(
      await readFile("scripts/phase6/payment-report-fixture.json", "utf8"),
    ),
  );
  expect(await visible(a, "paid_reports")).toEqual([]);
  await pg.query(
    "update paid_reports set status='ready',report_json=$1,model='synthetic-no-ai',prompt_version='payment-integration-example' where payment_id=$2 and status='queued'",
    [JSON.stringify(report), payment],
  );
  expect(await visible(a, "paid_reports")).toHaveLength(1);
  expect(await visible(a, "payments")).toHaveLength(1);
  expect(await visible(b, "paid_reports")).toEqual([]);
  expect(await visible(b, "payments")).toEqual([]);
});
it("authenticated clients cannot reassign the buyer or directly fulfill", async () => {
  await pg.exec("set role authenticated");
  try {
    await expect(
      pg.query("update payments set user_id=$1 where id=$2", [b, payment]),
    ).rejects.toThrow();
    await expect(apply("evt_client_fixture")).rejects.toThrow();
  } finally {
    await pg.exec("reset role");
  }
  expect(
    (await pg.query("select user_id from payments where id=$1", [payment]))
      .rows,
  ).toEqual([{ user_id: a }]);
});
it("anonymous role has no report access and no AI/subscription/customer rows exist", async () => {
  await pg.exec("set role anon");
  try {
    await expect(pg.query("select * from paid_reports")).rejects.toThrow();
  } finally {
    await pg.exec("reset role");
  }
  for (const table of ["ai_calls", "subscriptions", "billing_customers"])
    expect(
      (await pg.query(`select count(*)::int n from ${table}`)).rows,
    ).toEqual([{ n: 0 }]);
});
