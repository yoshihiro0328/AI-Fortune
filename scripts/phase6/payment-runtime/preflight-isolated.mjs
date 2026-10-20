// Test-only embedded PostgreSQL. No TCP listener, credentials, or external transport.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { TARGET, insist } from "./policy.mjs";
import { m as base } from "./offline-fixture.mjs";
import { seedSql } from "./fixture-sql.mjs";

export async function isolatedPayment() {
  const pg = await PGlite.create();
  try {
    await pg.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin nologin;",
    );
    await pg.exec(fs.readFileSync("scripts/phase6/auth-bootstrap.sql", "utf8"));
    const migrations = fs
      .readdirSync("supabase/migrations")
      .filter((x) => x.endsWith(".sql"))
      .sort();
    insist(migrations.length === 17);
    for (const file of migrations)
      await pg.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
    await pg.query(
      "update public.payment_environment set stripe_account_id=$1 where id",
      [TARGET.account],
    );
    await pg.query(
      `insert into public.price_versions(id,kind,amount,stripe_price_id,stripe_product_id,active,is_test) values ($1,'report',980,$2,$3,false,true),('synthetic-plus','plus',980,'price_synthetic_plus','prod_synthetic_plus',false,true)`,
      [TARGET.version, TARGET.price, TARGET.product],
    );
    for (const id of [base.a.id, base.b.id]) {
      await pg.query(
        "insert into auth.users(id,email_confirmed_at) values ($1,now())",
        [id],
      );
      await pg.query("insert into public.profiles(user_id) values ($1)", [id]);
    }
    const type = (
      await pg.query(
        "select id from public.diagnosis_types where slug='partner-mind'",
      )
    ).rows[0].id;
    const manifest = {
      ...base,
      type,
      answer: "10000000-0000-4000-8000-000000000006",
      freeReport: "10000000-0000-4000-8000-000000000007",
      anonymousHash: "d".repeat(64),
    };
    await pg.exec(seedSql(manifest)); // Local fixture setup only; launcher never seeds.
    const calls = [];
    const transport = async (r) => {
      const u = new URL(r.url);
      calls.push({
        method: r.method,
        path: u.pathname,
        query: u.search.slice(1),
      });
      if (u.origin === TARGET.stripe) {
        insist(
          r.method === "GET" && u.pathname === "/v1/account",
          "OFFLINE_STRIPE_OPERATION_DENIED",
        );
        return { status: 200, text: JSON.stringify({ id: TARGET.account }) };
      }
      insist(
        u.origin === TARGET.supabase && u.pathname.startsWith("/rest/v1/"),
        "OFFLINE_DESTINATION_DENIED",
      );
      const table = u.pathname.slice("/rest/v1/".length);
      insist(/^[a-z_]+$/.test(table));
      const q = Object.fromEntries(u.searchParams);
      const select = q.select ?? "*";
      insist(select === "*" || /^[a-z_]+(,[a-z_]+)*$/.test(select));
      const values = [],
        conditions = [];
      for (const [column, value] of Object.entries(q)) {
        if (["select", "limit"].includes(column)) continue;
        insist(/^[a-z_]+$/.test(column) && value.startsWith("eq."));
        values.push(value.slice(3));
        conditions.push(`"${column}"=$${values.length}`);
      }
      const where = conditions.length
        ? " where " + conditions.join(" and ")
        : "";
      const columns =
        select === "*"
          ? "*"
          : select
              .split(",")
              .map((x) => `"${x}"`)
              .join(",");
      insist(q.limit === undefined || /^\d+$/.test(q.limit));
      // Translate the *actual* REST selection/filter into SQL, then let PostgreSQL
      // resolve columns, ACL and values. This is not a PostgREST server emulator.
      let sql;
      if (r.method === "GET")
        sql = `select ${columns} from public."${table}"${where}${q.limit ? " limit " + q.limit : ""}`;
      else {
        insist(
          r.method === "PATCH" &&
            table === "price_versions" &&
            r.body === '{"active":false}' &&
            conditions.length === 5,
          "OFFLINE_WRITE_DENIED",
        );
        sql = `update public."price_versions" set active=false${where} returning *`;
      }
      await pg.exec("set role service_role");
      try {
        return {
          status: 200,
          text: JSON.stringify((await pg.query(sql, values)).rows),
        };
      } catch (e) {
        return { status: 400, text: JSON.stringify({ code: e.code }) };
      } finally {
        await pg.exec("reset role");
      }
    };
    return { pg, manifest, transport, calls, migrations };
  } catch (e) {
    await pg.close();
    throw e;
  }
}
