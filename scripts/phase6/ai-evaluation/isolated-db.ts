import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
// This adapter has no network/client/credential support. Every query executes in
// a disposable local database with the application's unmodified migrations.
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Error("LOCAL_SQL_IDENTIFIER");
  return '"' + s + '"';
};
const value = (v: unknown) =>
  typeof v === "object" && v !== null ? JSON.stringify(v) : v;
export async function evaluationDatabase() {
  const pg = await PGlite.create();
  try {
    await pg.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin nologin;",
    );
    await pg.exec(await readFile("scripts/phase6/auth-bootstrap.sql", "utf8"));
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
  } catch {
    await pg.close();
    throw Error("LOCAL_MIGRATIONS_FAILED");
  }
  function from(table: string) {
    ident(table);
    let columns = "*",
      method = "select",
      payload: Record<string, unknown> | undefined,
      sort = "",
      take = "",
      executed = false;
    const predicates: { key: string; operator: string; v: unknown }[] = [];
    const query = {
      select(c = "*") {
        columns = c === "*" ? "*" : c.split(",").map(ident).join(",");
        return query;
      },
      insert(v: Record<string, unknown>) {
        method = "insert";
        payload = v;
        return query;
      },
      update(v: Record<string, unknown>) {
        method = "update";
        payload = v;
        return query;
      },
      delete() {
        method = "delete";
        return query;
      },
      eq(key: string, v: unknown) {
        predicates.push({ key, operator: "=", v });
        return query;
      },
      in(key: string, v: unknown[]) {
        predicates.push({ key, operator: "in", v });
        return query;
      },
      order(key: string, opts?: { ascending?: boolean }) {
        sort = ` order by ${ident(key)} ${opts?.ascending === false ? "desc" : "asc"}`;
        return query;
      },
      limit(n: number) {
        if (!Number.isInteger(n) || n < 1 || n > 100)
          throw Error("LOCAL_LIMIT");
        take = " limit " + n;
        return query;
      },
      async execute() {
        if (executed) throw Error("LOCAL_QUERY_ALREADY_EXECUTED");
        executed = true;
        const args: unknown[] = [];
        const param = (v: unknown) => {
          args.push(value(v));
          return "$" + args.length;
        };
        const fields = Object.keys(payload ?? {});
        const assignments = fields
          .map((k) => `${ident(k)}=${param(payload![k])}`)
          .join(",");
        const where = predicates
          .map((p) =>
            p.operator === "in"
              ? `${ident(p.key)} in (${(p.v as unknown[]).map(param).join(",")})`
              : `${ident(p.key)}=${param(p.v)}`,
          )
          .join(" and ");
        let sql;
        if (method === "select")
          sql = `select ${columns} from ${ident(table)}${where ? " where " + where : ""}${sort}${take}`;
        else if (method === "insert") {
          if (!fields.length) throw Error("LOCAL_EMPTY_INSERT");
          sql = `insert into ${ident(table)} (${fields.map(ident)}) values (${fields.map((_, i) => "$" + (i + 1))}) returning ${columns}`;
        } else {
          if (!where) throw Error("LOCAL_UNSCOPED_WRITE");
          sql = `${method === "update" ? `update ${ident(table)} set ${assignments}` : `delete from ${ident(table)}`} where ${where} returning ${columns}`;
        }
        try {
          return {
            data: JSON.parse(JSON.stringify((await pg.query(sql, args)).rows)),
            error: null,
          };
        } catch {
          return { data: null, error: "LOCAL_DATABASE_QUERY_FAILED" };
        }
      },
      async single() {
        const r = await query.execute();
        return {
          data: r.data?.length === 1 ? r.data[0] : null,
          error: r.error ?? (r.data?.length !== 1 ? "LOCAL_CARDINALITY" : null),
        };
      },
      async maybeSingle() {
        const r = await query.execute();
        return {
          data: r.data?.[0] ?? null,
          error: r.error ?? (r.data?.length > 1 ? "LOCAL_CARDINALITY" : null),
        };
      },
      then(resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) {
        return query.execute().then(resolve, reject);
      },
    };
    return query;
  }
  const functions: Record<string, { args: string[]; set?: boolean }> = {
    acquire_lock: { args: ["p_key", "p_token"] },
    claim_report: { args: ["p_diagnosis", "p_token"], set: true },
    finish_report: {
      args: ["p_diagnosis", "p_token", "p_report", "p_model", "p_version"],
    },
    save_question_plan: { args: ["p_diagnosis", "p_flow", "p_questions"] },
  };
  const adapter = {
    from,
    async rpc(name: string, args: Record<string, unknown>) {
      const f = functions[name];
      if (!f || Object.keys(args).sort().join() !== [...f.args].sort().join())
        throw Error("LOCAL_RPC_DENIED");
      try {
        const rows = (
          await pg.query(
            `select ${f.set ? "* from " : ""}${ident(name)}(${f.args.map((_, i) => "$" + (i + 1))})${f.set ? "" : " as value"}`,
            f.args.map((k) => value(args[k])),
          )
        ).rows as { value: unknown }[];
        return {
          data: JSON.parse(JSON.stringify(f.set ? rows : rows[0]?.value)),
          error: null,
        };
      } catch {
        return { data: null, error: "LOCAL_RPC_FAILED" };
      }
    },
  };
  return { pg, adapter, close: () => pg.close() };
}
