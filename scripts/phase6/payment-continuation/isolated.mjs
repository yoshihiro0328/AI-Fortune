// Test-only. All provider calls resolve in embedded PostgreSQL or synthetic Auth.
import { isolatedPayment } from "../payment-runtime/preflight-isolated.mjs";
import { TARGET, insist } from "../payment-runtime/policy.mjs";
import { snapshot } from "./state.mjs";
export async function isolatedPaid() {
  const db = await isolatedPayment(),
    pg = db.pg,
    m = db.manifest;
  const expected = {
    payment: "20000000-0000-4000-8000-000000000001",
    report: null,
    checkout: "cs_test_retained",
    intent: "pi_retained",
    event: "evt_retained",
  };
  await pg.query(
    "insert into payments(id,diagnosis_id,user_id,amount,is_test,price_version) values($1,$2,$3,980,true,$4)",
    [expected.payment, m.diagnosis, m.a.id, TARGET.version],
  );
  await pg.query(
    "select apply_stripe_event_v2($1,$2,$3,$4,$5,$6,980,'jpy','paid',true,null)",
    [
      expected.event,
      "checkout.session.completed",
      "a".repeat(64),
      expected.checkout,
      expected.intent,
      expected.payment,
    ],
  );
  await pg.query(
    "insert into analytics_events(event_name,metadata,is_test) values('checkout_started',$1::jsonb,true)",
    [JSON.stringify({ diagnosis_id: m.diagnosis })],
  );
  await pg.query("update price_versions set active=false where id=$1", [
    TARGET.version,
  ]);
  expected.report = (await pg.query("select id from paid_reports")).rows[0].id;
  const sessions = new Map(),
    calls = [];
  let serial = Promise.resolve();
  const token = (id) =>
    [
      "eyJhbGciOiJIUzI1NiJ9",
      Buffer.from(
        JSON.stringify({
          iss: TARGET.supabase + "/auth/v1",
          sub: id,
          role: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url"),
      "synthetic",
    ].join(".");
  const transport = (r) => {
    const task = serial.then(async () => {
      const u = new URL(r.url),
        h = new Headers(r.headers);
      insist(u.origin === TARGET.supabase, "OFFLINE_EXTERNAL_DENIED");
      calls.push({ method: r.method, path: u.pathname });
      const result = (x) => ({ status: 200, text: JSON.stringify(x) });
      if (u.pathname === "/auth/v1/token") {
        const b = JSON.parse(r.body),
          user = [m.a, m.b].find((x) => x.email === b.email);
        insist(user);
        const s = {
          access_token: token(user.id),
          refresh_token: "synthetic-" + user.id,
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          user: {
            id: user.id,
            email: user.email,
            email_confirmed_at: "2026-01-01T00:00:00Z",
            aud: "authenticated",
            role: "authenticated",
          },
        };
        sessions.set(s.access_token, s);
        return result(s);
      }
      if (u.pathname === "/auth/v1/user") {
        const s = sessions.get(h.get("authorization")?.slice(7));
        insist(s);
        return result(s.user);
      }
      const t = u.pathname.replace("/rest/v1/", "");
      if (t.startsWith("rpc/")) {
        const b = JSON.parse(r.body);
        let sql, args;
        if (t === "rpc/consume_limit") {
          sql = "select consume_limit($1,$2,$3) as value";
          args = [b.p_key, b.p_limit, b.p_seconds];
        } else {
          insist(t === "rpc/claim_anonymous_diagnoses");
          sql = "select claim_anonymous_diagnoses($1,$2) as value";
          args = [b.p_user, b.p_session];
        }
        await pg.exec("set role service_role");
        try {
          return result((await pg.query(sql, args)).rows[0].value);
        } finally {
          await pg.exec("reset role");
        }
      }
      insist(r.method === "GET" && /^[a-z_]+$/.test(t));
      const q = Object.fromEntries(u.searchParams),
        v = [],
        w = [];
      const select = q.select ?? "*";
      insist(select === "*" || /^[a-z_]+(,[a-z_]+)*$/.test(select));
      for (const [k, value] of Object.entries(q)) {
        if (["select", "limit", "offset", "order"].includes(k)) continue;
        insist(/^[a-z_]+$/.test(k) && value.startsWith("eq."));
        v.push(value.slice(3));
        w.push('"' + k + '"=$' + v.length);
      }
      const sort =
        q.order === "created_at.desc" ? " order by created_at desc" : "";
      const tail =
        (q.limit ? " limit " + Number(q.limit) : "") +
        (q.offset ? " offset " + Number(q.offset) : "");
      const bearer = h.get("authorization")?.slice(7);
      let role = "service_role",
        sub = "";
      if (h.get("apikey") === "local-anon") {
        const session = sessions.get(bearer);
        if (!session) return { status: 401, text: '{"code":"PGRST301"}' };
        role = "authenticated";
        sub = session.user.id;
      }
      await pg.exec("begin");
      try {
        await pg.exec("set local role " + role);
        await pg.query("select set_config('request.jwt.claim.sub',$1,true)", [
          sub,
        ]);
        const rows = (
          await pg.query(
            "select " +
              select +
              ' from public."' +
              t +
              '"' +
              (w.length ? " where " + w.join(" and ") : "") +
              sort +
              tail,
            v,
          )
        ).rows;
        await pg.exec("commit");
        return result(
          h.get("accept")?.includes("vnd.pgrst.object")
            ? (rows[0] ?? null)
            : rows,
        );
      } catch (e) {
        await pg.exec("rollback");
        return { status: 400, text: JSON.stringify({ code: e.code }) };
      }
    });
    serial = task.catch(() => {});
    return task;
  };
  const read = async (p) =>
    JSON.parse(
      (
        await transport({
          url: TARGET.supabase + "/rest/v1/" + p,
          method: "GET",
          headers: {
            apikey: "local-service",
            authorization: "Bearer local-service",
          },
        })
      ).text,
    );
  const baseline = await snapshot(read);
  return {
    pg,
    m,
    expected,
    baseline,
    transport,
    calls,
    read,
    sessions,
    close: () => pg.close(),
  };
}
