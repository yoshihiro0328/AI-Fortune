import { afterEach, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import {
  isolatedDb,
  applyIsolation,
  migrationName,
} from "./helpers/isolated-db";
import type { PGlite } from "@electric-sql/pglite";
let pg: PGlite;
const fix = "20261015081652_trial_auth_verification.sql";
const verified = "20000000-0000-4000-8000-000000000001";
const unverified = "20000000-0000-4000-8000-000000000002";
const missing = "20000000-0000-4000-8000-000000000003";
async function setup(includeFix = true) {
  pg = await isolatedDb();
  await applyIsolation(pg);
  for (const n of (await readdir("supabase/migrations"))
    .filter(
      (n) =>
        n.endsWith(".sql") && n > migrationName && (includeFix || n !== fix),
    )
    .sort())
    await pg.exec(await readFile("supabase/migrations/" + n, "utf8"));
  await pg.exec(
    `insert into auth.users(id,email_confirmed_at) values('${verified}',now()),('${unverified}',null)`,
  );
}
async function asRole(role: string, sql: string, args: unknown[] = []) {
  await pg.exec(`set role ${role}`);
  try {
    return await pg.query(sql, args);
  } finally {
    await pg.exec("reset role");
  }
}
const claim =
  "select public.trial_claim(repeat('a',64),$1,null,null,null,null,'{}') as result";
const authState = `select relrowsecurity, relacl::text, (select count(*) from pg_policies where schemaname='auth') as policies from pg_class where oid='auth.users'::regclass`;
afterEach(async () => {
  await pg?.close();
});

it("reproduces the pre-17 permission failure and repairs it without changing Auth ACL/RLS", async () => {
  await setup(false);
  const before = await pg.query(authState);
  await expect(asRole("service_role", claim, [verified])).rejects.toThrow(
    /permission denied/,
  );
  await pg.exec(await readFile("supabase/migrations/" + fix, "utf8"));
  expect(await pg.query(authState)).toEqual(before);
  expect((await asRole("service_role", claim, [verified])).rows).toEqual([
    { result: { error: "expired" } },
  ]);
});
it("pins boolean-only elevation to postgres and keeps claim invoker with an empty search_path", async () => {
  await setup();
  const r = await pg.query(
    `select p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig, p.prorettype::regtype::text as result_type from pg_proc p where oid='trial_private.email_verified(uuid)'::regprocedure`,
  );
  expect(r.rows).toEqual([
    {
      prosecdef: true,
      owner: "postgres",
      proconfig: ['search_path=""'],
      result_type: "boolean",
    },
  ]);
  expect(
    (
      await pg.query(
        `select prosecdef from pg_proc where oid='public.trial_claim(text,uuid,uuid,text,text,text,jsonb)'::regprocedure`,
      )
    ).rows,
  ).toEqual([{ prosecdef: false }]);
  expect(
    (
      await pg.query(
        `select count(*)::int as n from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='trial_private.email_verified(uuid)'::regprocedure and a.grantee=0`,
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  expect(
    (
      await pg.query(
        `select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','trial_private') and p.prosrc like '%from auth.users%' order by 1`,
      )
    ).rows,
  ).toEqual([
    { name: "public.protect_payment_environment" },
    { name: "trial_private.email_verified" },
  ]);
  for (const role of ["anon", "authenticated"]) {
    expect(
      (
        await pg.query(
          `select has_function_privilege($1,'trial_private.email_verified(uuid)','EXECUTE') as allowed`,
          [role],
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
  }
  expect(
    (
      await pg.query(
        `select has_schema_privilege('service_role','trial_private','CREATE') as allowed`,
      )
    ).rows,
  ).toEqual([{ allowed: false }]);
  expect(
    (
      await pg.query(
        `select relrowsecurity from pg_class where oid='auth.users'::regclass`,
      )
    ).rows,
  ).toEqual([{ relrowsecurity: true }]);
});
it.each(["anon", "authenticated", "service_role"])(
  "%s cannot directly read Auth rows",
  async (role) => {
    await setup();
    await expect(
      asRole(role, "select id,email_confirmed_at from auth.users"),
    ).rejects.toThrow(/permission denied/);
  },
);
it.each(["anon", "authenticated", "public_probe"])(
  "%s cannot execute the private verifier or the claim RPC",
  async (role) => {
    await setup();
    if (role === "public_probe")
      await pg.exec("create role public_probe nologin");
    await expect(
      asRole(role, "select trial_private.email_verified($1)", [verified]),
    ).rejects.toThrow(/permission denied/);
    await expect(asRole(role, claim, [verified])).rejects.toThrow(
      /permission denied/,
    );
  },
);
it.each([
  [verified, true],
  [unverified, false],
  [missing, false],
  [null, false],
])(
  "verifier returns only the current Auth boolean for %s",
  async (id, value) => {
    await setup();
    expect(
      (
        await asRole(
          "service_role",
          "select trial_private.email_verified($1) as verified",
          [id],
        )
      ).rows,
    ).toEqual([{ verified: value }]);
  },
);
it("ignores spoofed JWT verification metadata and rechecks changed Auth state", async () => {
  await setup();
  await pg.exec(
    `select set_config('request.jwt.claims','{"email_confirmed_at":"2099-01-01","user_metadata":{"verified":true}}',false)`,
  );
  expect(
    (
      await asRole(
        "service_role",
        "select trial_private.email_verified($1) as verified",
        [unverified],
      )
    ).rows,
  ).toEqual([{ verified: false }]);
  await pg.exec(
    `update auth.users set email_confirmed_at=null where id='${verified}'`,
  );
  expect((await asRole("service_role", claim, [verified])).rows).toEqual([
    { result: { error: "auth" } },
  ]);
});
it.each([unverified, missing, null])(
  "invalid Auth identity %s cannot create history or change ownership",
  async (id) => {
    await setup();
    const before = await pg.query(
      "select (select count(*) from consultation_subjects) as subjects,(select count(*) from consultation_threads) as threads,(select count(*) from consultation_turns) as turns,(select count(*) from trial_private.sessions where claimed_by is not null) as claims",
    );
    expect((await asRole("service_role", claim, [id])).rows).toEqual([
      { result: { error: "auth" } },
    ]);
    expect(
      await pg.query(
        "select (select count(*) from consultation_subjects) as subjects,(select count(*) from consultation_threads) as threads,(select count(*) from consultation_turns) as turns,(select count(*) from trial_private.sessions where claimed_by is not null) as claims",
      ),
    ).toEqual(before);
  },
);
it("Stripe Auth-reading guard remains owner-only and refuses relabelling after users exist", async () => {
  await setup();
  await expect(
    asRole(
      "service_role",
      "update payment_environment set stripe_account_id='acct_forbidden'",
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    pg.exec(
      "update payment_environment set stripe_account_id='acct_forbidden'",
    ),
  ).rejects.toThrow("only an empty project may be initialized");
  expect(
    (await pg.query("select stripe_account_id from payment_environment")).rows,
  ).toEqual([{ stripe_account_id: "acct_1UNSvsIYwtQeIHKP" }]);
});
