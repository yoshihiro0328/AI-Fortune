/** Runs only inside the existing freshly-created Docker HTTP harness. */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  fixturePlan,
  insertSQL,
  cleanupSQL,
  tables,
} from "./step10-fixtures.mjs";
export async function step10Isolated({
  sql,
  object,
  request,
  restURL,
  jwt,
  authCookie,
  users,
  sessionSecret,
  eventCount,
}) {
  assert.equal(new URL(restURL).hostname, "127.0.0.1");
  const checks = [];
  const test = async (name, fn) => {
    await fn();
    checks.push(name);
    console.log("PASS STEP10 " + name);
  };
  const [a, b, unconfirmed] = users;
  const raw = [
    randomBytes(32).toString("base64url"),
    randomBytes(32).toString("base64url"),
  ];
  const hashes = raw.map((v) =>
    createHmac("sha256", sessionSecret).update(v).digest("hex"),
  );
  const p = fixturePlan([a.id, b.id], hashes);
  const cookie = (i) => "yorisoi_session=" + raw[i];
  const signed = (u, i) => authCookie(u) + "; " + cookie(i);
  const claim = (u, i, extra = {}) =>
    request("/api/auth", {
      method: "POST",
      cookie: signed(u, i),
      data: { action: "claim", ...extra },
    });
  const rpc = (token) =>
    fetch(restURL + "/rpc/claim_anonymous_diagnoses", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_user: a.id, p_session: hashes[0] }),
    });
  const rows = async (table, token, filter = "") => {
    const r = await fetch(restURL + "/" + table + "?select=id" + filter, {
      headers: { authorization: "Bearer " + token },
    });
    return { status: r.status, data: await r.json() };
  };
  const baselineQuery =
    "select jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),'users',(select count(*) from auth.users),'payments',(select count(*) from public.payments),'subscriptions',(select count(*) from public.subscriptions),'customers',(select count(*) from public.billing_customers),'settings',(select to_jsonb(s) from public.service_settings s));";
  for (const u of [a, b])
    sql(
      `insert into public.profiles(user_id) values('${u.id}') on conflict(user_id) do nothing;`,
    );
  sql("update trial_private.settings set enabled=false;");
  const baseline = object(baselineQuery),
    generations = eventCount("generation");
  assert.equal(baseline.payments, 0);
  assert.equal(baseline.subscriptions, 0);
  assert.equal(baseline.customers, 0);
  const count = () =>
    Object.fromEntries(
      tables.map((t) => [
        t,
        Number(
          sql(
            `select count(*) from public.${t} where id in (${p.rows[t].map((x) => "'" + x + "'").join(",")})`,
          ),
        ),
      ]),
    );
  await test("01 twelve synthetic rows; no users, payments or AI creation", async () => {
    sql(insertSQL(p));
    assert.deepEqual(Object.values(count()), [2, 2, 2, 2, 2, 2]);
  });
  await test("02 A/B consultation RLS own/other/all", async () => {
    for (let i = 0; i < 2; i++)
      for (const t of tables.slice(0, 3)) {
        const token = jwt("authenticated", users[i].id),
          own = await rows(t, token, "&id=eq." + p.rows[t][i]),
          other = await rows(t, token, "&id=eq." + p.rows[t][1 - i]),
          all = await rows(t, token);
        assert.equal(own.status, 200);
        assert.deepEqual(own.data, [{ id: p.rows[t][i] }]);
        assert.deepEqual(other.data, []);
        assert.deepEqual(all.data, own.data);
      }
  });
  await test("03 unauthenticated and bad JWT denied by real PostgREST", async () => {
    for (const t of tables)
      for (const token of [jwt("anon"), "invalid.jwt.value"])
        assert.ok([401, 403].includes((await rows(t, token)).status));
  });
  await test("04 A/B real API lists and own thread contents", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await request("/api/consultations", {
        cookie: authCookie(users[i]),
      });
      assert.equal(r.status, 200);
      assert.deepEqual(
        r.data.subjects.map((x) => x.id),
        [p.rows.consultation_subjects[i]],
      );
      assert.deepEqual(
        r.data.threads.map((x) => x.id),
        [p.rows.consultation_threads[i]],
      );
      const detail = await request(
        "/api/consultations?thread=" + p.rows.consultation_threads[i],
        { cookie: authCookie(users[i]) },
      );
      assert.equal(detail.status, 200);
      assert.deepEqual(
        detail.data.turns.map((x) => x.id),
        [p.rows.consultation_turns[i]],
      );
    }
  });
  await test("05 A/B cross-thread API denies both directions", async () => {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await request(
            "/api/consultations?thread=" + p.rows.consultation_threads[1 - i],
            { cookie: authCookie(users[i]) },
          )
        ).status,
        404,
      );
  });
  await test("06 API no login / invalid JWT / unconfirmed denied", async () => {
    for (const c of [
      undefined,
      authCookie(a, true),
      authCookie(unconfirmed),
      "sb-127-auth-token=base64-" +
        Buffer.from(
          JSON.stringify({
            access_token: "invalid.jwt.value",
            refresh_token: "invalid",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString("base64url"),
    ])
      for (const suffix of ["", "?thread=" + p.rows.consultation_threads[0]])
        assert.equal(
          (await request("/api/consultations" + suffix, { cookie: c })).status,
          401,
        );
  });
  await test("07 anonymous diagnoses session A/B cannot cross-read", async () => {
    for (let i = 0; i < 2; i++) {
      assert.equal(
        (
          await request("/api/diagnoses?id=" + p.rows.diagnoses[i], {
            cookie: cookie(i),
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/api/diagnoses?id=" + p.rows.diagnoses[1 - i], {
            cookie: cookie(i),
          })
        ).status,
        404,
      );
      assert.deepEqual(
        (await request("/api/diagnoses", { cookie: cookie(i) })).data.map(
          (x) => x.id,
        ),
        [p.rows.diagnoses[i]],
      );
    }
  });
  await test("08 browser RPC denied; no anonymous RLS disclosure", async () => {
    for (const token of [
      jwt("anon"),
      jwt("authenticated", a.id),
      jwt("authenticated", b.id),
    ])
      assert.ok([401, 403].includes((await rpc(token)).status));
    for (const u of [a, b])
      for (const t of tables.slice(3))
        assert.deepEqual((await rows(t, jwt("authenticated", u.id))).data, []);
  });
  await test("09 unconfirmed, missing auth and bad JWT cannot claim", async () => {
    assert.equal((await claim(unconfirmed, 0)).status, 403);
    for (const c of [
      "yorisoi_session=unauthenticated-control",
      authCookie(a, true) + "; yorisoi_session=invalid-jwt-control",
    ])
      assert.equal(
        (
          await request("/api/auth", {
            method: "POST",
            cookie: c,
            data: { action: "claim" },
          })
        ).status,
        401,
      );
    assert.equal(
      sql(
        `select count(*) from public.diagnoses where id in ('${p.rows.diagnoses.join("','")}') and user_id is not null`,
      ),
      "0",
    );
  });
  await test("10 CSRF and forged anonymous cookie do not claim", async () => {
    assert.equal(
      (
        await request("/api/auth", {
          method: "POST",
          originHeader: "https://attacker.invalid",
          cookie: signed(a, 0),
          data: { action: "claim" },
        })
      ).status,
      403,
    );
    const r = await request("/api/auth", {
      method: "POST",
      cookie: authCookie(a) + "; yorisoi_session=forged-session",
      data: { action: "claim", p_session: hashes[0], p_user: b.id },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.count, 0);
  });
  await test("11 concurrent A claims exactly once; request user/session arguments ignored", async () => {
    const r = await Promise.all([
      claim(a, 0, { p_user: b.id, p_session: hashes[1] }),
      claim(a, 0),
    ]);
    assert.ok(r.every((x) => x.status === 200));
    assert.deepEqual(r.map((x) => x.data.count).sort(), [0, 1]);
    assert.equal(
      sql(
        `select user_id from public.diagnoses where id='${p.rows.diagnoses[0]}'`,
      ),
      a.id,
    );
    assert.equal(
      sql(
        `select user_id is null from public.diagnoses where id='${p.rows.diagnoses[1]}'`,
      ),
      "t",
    );
  });
  await test("12 B claims only session B and profile rows unchanged", async () => {
    const r = await claim(b, 1);
    assert.equal(r.status, 200);
    assert.equal(r.data.count, 1);
    assert.deepEqual(object(baselineQuery), baseline);
  });
  await test("13 replay by same and other accounts does not transfer ownership", async () => {
    for (const [u, i] of [
      [a, 0],
      [b, 0],
      [b, 1],
      [a, 1],
    ]) {
      const r = await claim(u, i);
      assert.equal(r.status, 200);
      assert.equal(r.data.count, 0);
    }
    for (let i = 0; i < 2; i++) {
      for (const table of tables.slice(0, 4)) {
        const response = await fetch(
          restURL + "/" + table + "?id=eq." + p.rows[table][i],
          {
            method: "PATCH",
            headers: {
              authorization: "Bearer " + jwt("authenticated", users[i].id),
              "content-type": "application/json",
            },
            body: JSON.stringify({ user_id: users[1 - i].id }),
          },
        );
        assert.ok([401, 403].includes(response.status));
        assert.equal(
          sql(
            `select user_id from public.${table} where id='${p.rows[table][i]}'`,
          ),
          users[i].id,
        );
      }
      assert.equal(
        sql(
          `select user_id from public.diagnoses where id='${p.rows.diagnoses[i]}'`,
        ),
        users[i].id,
      );
    }
  });
  await test("14 claimed diagnoses and child rows RLS isolated", async () => {
    for (let i = 0; i < 2; i++)
      for (const t of tables.slice(3)) {
        const r = await rows(t, jwt("authenticated", users[i].id));
        assert.equal(r.status, 200);
        assert.deepEqual(r.data, [{ id: p.rows[t][i] }]);
      }
  });
  await test("15 claimed diagnosis API denies old anonymous cookie and other owner", async () => {
    for (let i = 0; i < 2; i++) {
      assert.equal(
        (
          await request("/api/diagnoses?id=" + p.rows.diagnoses[i], {
            cookie: authCookie(users[i]),
          })
        ).status,
        200,
      );
      for (const c of [cookie(i), signed(users[1 - i], i)])
        assert.equal(
          (
            await request("/api/diagnoses?id=" + p.rows.diagnoses[i], {
              cookie: c,
            })
          ).status,
          404,
        );
    }
  });
  await test("16 cleanup refuses unknown cascading child and rolls back", async () => {
    const extra = randomUUID();
    sql(
      `insert into public.diagnosis_answers(id,diagnosis_id,question_key,question_text,answer_text) values('${extra}','${p.rows.diagnoses[0]}','unexpected','local-only','local-only');`,
    );
    assert.throws(() => sql(cleanupSQL(p)), /Unexpected dependent fixture row/);
    assert.deepEqual(Object.values(count()), [2, 2, 2, 2, 2, 2]);
    sql(`delete from public.diagnosis_answers where id='${extra}';`);
    sql(
      "create table public.step10_unexpected_dependency(id uuid primary key, diagnosis_id uuid references public.diagnoses(id) on delete cascade);",
    );
    assert.throws(() => sql(cleanupSQL(p)), /Fixture FK schema drift/);
    assert.deepEqual(Object.values(count()), [2, 2, 2, 2, 2, 2]);
    sql("drop table public.step10_unexpected_dependency;");
  });
  await test("17 UUID-only cleanup leaves profiles/Auth/quotas unchanged", async () => {
    sql(cleanupSQL(p));
    assert.deepEqual(Object.values(count()), [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(object(baselineQuery), baseline);
  });
  await test("18 trial remains OFF and zero provider generation", async () => {
    assert.equal(sql("select enabled from trial_private.settings"), "f");
    assert.equal(eventCount("generation"), generations);
  });
  return {
    passed: checks.length,
    checks,
    hostedExecuted: false,
    auth: "synthetic getUser; real signed PostgREST JWT + RLS",
    plannedRows: 12,
  };
}
