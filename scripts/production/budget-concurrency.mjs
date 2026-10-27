// Dedicated local PostgreSQL only: no network, host ports, mounts, real credentials or external data.
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const name = `yorisoi-budget-fixture-${randomUUID().slice(0, 8)}`;
const image = "public.ecr.aws/supabase/postgres:17.11.0.004";
const docker = (args, options = {}) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
const sql = (text) =>
  docker(
    [
      "exec",
      "-i",
      name,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: text },
  );
let created = false;
try {
  docker([
    "run",
    "--pull=never",
    "--detach",
    "--name",
    name,
    "--network=none",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_PASSWORD=synthetic",
    "--entrypoint",
    "docker-entrypoint.sh",
    image,
    "postgres",
  ]);
  created = true;
  let ready = false;
  for (let n = 0; n < 40; n++) {
    try {
      docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert(ready, "local database not ready");
  sql(
    "do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;",
  );
  sql(
    "create table public.consultation_turns(is_test boolean not null default true); create table public.diagnoses(is_test boolean not null default true); create table public.analytics_events(is_test boolean not null default true); create function public.payment_is_test() returns boolean language sql as $$ select false $$;",
  );
  sql(
    readFileSync(
      "supabase/migrations/20261027072559_production_operation_controls.sql",
      "utf8",
    ),
  );
  sql(
    "insert into production_controls(environment_id,generation_enabled,sales_enabled,daily_limit_nusd,monthly_limit_nusd,pricing_valid_until) values('concurrency-fixture',true,true,1000000000,10000000000,now()+interval '1 hour');",
  );
  const outcomes = await Promise.allSettled(
    Array.from({ length: 8 }, async () => {
      const id = randomUUID();
      const r = await exec("docker", [
        "exec",
        name,
        "psql",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
        "-c",
        `begin; select reserve_production_ai('${id}','concurrency-fixture',8500); select pg_sleep(0.2); commit;`,
      ]);
      return r.stdout.split("\n").includes("t");
    }),
  );
  assert.equal(
    outcomes.filter((r) => r.status === "rejected").length,
    0,
    "all local connections must complete",
  );
  assert.equal(
    outcomes.filter((r) => r.status === "fulfilled" && r.value).length,
    1,
  );
  assert.equal(
    sql("select count(*) from production_ai_reservations;").trim(),
    "1",
  );
  assert.equal(
    sql(
      "select sum(reserved_nusd)<=1000000000 from production_ai_reservations;",
    ).trim(),
    "t",
  );
  console.log(
    JSON.stringify({
      passed: true,
      concurrentConnections: 8,
      reservationsAccepted: 1,
      network: "none",
      externalCalls: 0,
    }),
  );
} finally {
  if (created) docker(["rm", "--force", name]);
}
