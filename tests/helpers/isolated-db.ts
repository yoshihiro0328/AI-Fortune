import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export const migrationName = "20261013074636_stripe_environment_isolation.sql";
export async function isolatedDb() {
  const pg = await PGlite.create();
  // Only Supabase's platform-owned Auth schema is stubbed. Application migrations run unmodified.
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth;
 create table auth.users(id uuid primary key, created_at timestamptz default now(), email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to service_role;
 `);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql") && n < migrationName)
    .sort()) {
    await pg.exec(await readFile("supabase/migrations/" + name, "utf8"));
  }
  return pg;
}
export async function applyIsolation(pg: PGlite) {
  await pg.exec(await readFile("supabase/migrations/" + migrationName, "utf8"));
}
