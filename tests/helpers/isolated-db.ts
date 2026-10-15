import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export const migrationName = "20261013074636_stripe_environment_isolation.sql";
export async function isolatedDb() {
  const pg = await PGlite.create();
  // Only Supabase's platform-owned Auth schema is stubbed. Application migrations run unmodified.
  await pg.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin nologin;",
  );
  await pg.exec(await readFile("scripts/phase6/auth-bootstrap.sql", "utf8"));
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
