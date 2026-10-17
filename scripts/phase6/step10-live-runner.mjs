/** Hosted STEP10 only. Twelve pre-existing manifest fixtures, no insert/delete/user/email path. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { origin, appOrigin, context } from "./step10-live-policy.mjs";
import { tables } from "./step10-fixtures.mjs";
import { read, unseal, stop } from "./step10-private.mjs";
const dir = process.env.STEP10_PRIVATE,
  r = read(dir, "runtime.json"),
  p = read(dir, "manifest.json"),
  raw = unseal(dir, "anonymous.aesgcm");
context(r, p, raw);
if (
  fs.existsSync(path.join(dir, "STOP")) ||
  fs.readFileSync(path.join(dir, "stage"), "utf8").trim() !== "run" ||
  !fs.existsSync(path.join(dir, "insert-verified.json"))
)
  throw Error("Missing verified insertion gate");
const sessions = ["a", "b"].map((l) => unseal(dir, "session-" + l + ".aesgcm"));
if (sessions.some((s) => s.expires < Date.now() / 1000 + 600))
  throw Error("Fresh authentication required before run");
fs.writeFileSync(path.join(dir, "run.reserved"), new Date().toISOString(), {
  mode: 0o600,
  flag: "wx",
});
const checks = [];
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  fs.appendFileSync(
    path.join(dir, "results.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), name, passed: true }) + "\n",
    { mode: 0o600 },
  );
  console.log("PASS " + name);
};
const token = (i) => sessions[i].access_token;
const authCookie = (i) => sessions[i].cookie;
const cookie = (i) => "yorisoi_session=" + raw[i];
const api = async (
  route,
  { method = "GET", cookies, body, csrf = appOrigin } = {},
) => {
  const rr = await fetch("http://127.0.0.1:5208" + route, {
    method,
    headers: {
      "x-step10-control": r.PHASE6_PROXY_TOKEN,
      origin: csrf,
      "content-type": "application/json",
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: rr.status, data: await rr.json() };
};
const rest = async (
  table,
  {
    bearer,
    service = false,
    method = "GET",
    filter = "",
    select = "id",
    body,
  } = {},
) => {
  const rr = await fetch(
    origin +
      "/rest/v1/" +
      table +
      (method === "POST"
        ? ""
        : "?" +
          (method === "GET" ? "select=" + select + (filter ? "&" : "") : "") +
          filter),
    {
      method,
      headers: {
        apikey: service
          ? r.SUPABASE_SERVICE_ROLE_KEY
          : r.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        authorization:
          "Bearer " +
          (service
            ? r.SUPABASE_SERVICE_ROLE_KEY
            : (bearer ?? r.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const text = await rr.text();
  return { status: rr.status, data: text ? JSON.parse(text) : null };
};
const owners = async () => {
  const x = await rest("diagnoses", { service: true, select: "id,user_id" });
  assert.equal(x.status, 200);
  return Object.fromEntries(x.data.map((v) => [v.id, v.user_id]));
};
const claim = (i, anon = i, extra = {}) =>
  api("/api/auth", {
    method: "POST",
    cookies: authCookie(i) + "; " + cookie(anon),
    body: { action: "claim", ...extra },
  });
try {
  await check(
    "01 live fixture counts and both verified identities",
    async () => {
      for (let i = 0; i < 2; i++) {
        const rr = await fetch(origin + "/auth/v1/user", {
          headers: {
            apikey: r.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            authorization: "Bearer " + token(i),
          },
        });
        const u = await rr.json();
        assert.equal(rr.status, 200);
        assert.equal(u.id, p.users[i]);
        assert.ok(u.email_confirmed_at);
      }
      for (const t of tables) {
        const v = await rest(t, { service: true });
        assert.equal(v.status, 200);
        assert.deepEqual(v.data.map((x) => x.id).sort(), [...p.rows[t]].sort());
      }
      assert.deepEqual(
        await owners(),
        Object.fromEntries(p.rows.diagnoses.map((id) => [id, null])),
      );
    },
  );
  await check("02 real user JWT consultation RLS own, other, all", async () => {
    for (let i = 0; i < 2; i++)
      for (const t of tables.slice(0, 3))
        for (const [filter, expected] of [
          ["", [{ id: p.rows[t][i] }]],
          ["id=eq." + p.rows[t][i], [{ id: p.rows[t][i] }]],
          ["id=eq." + p.rows[t][1 - i], []],
        ]) {
          const v = await rest(t, { bearer: token(i), filter });
          assert.equal(v.status, 200);
          assert.deepEqual(v.data, expected);
        }
  });
  await check("03 anon and invalid JWT REST denial", async () => {
    for (const t of tables)
      for (const bearer of [undefined, "invalid.jwt.value"])
        assert.ok([401, 403].includes((await rest(t, { bearer })).status));
  });
  await check(
    "04 real application lists and thread text; cross-owner 404",
    async () => {
      for (let i = 0; i < 2; i++) {
        const all = await api("/api/consultations", { cookies: authCookie(i) });
        assert.equal(all.status, 200);
        assert.deepEqual(
          all.data.subjects.map((x) => x.id),
          [p.rows.consultation_subjects[i]],
        );
        assert.deepEqual(
          all.data.threads.map((x) => x.id),
          [p.rows.consultation_threads[i]],
        );
        const own = await api(
          "/api/consultations?thread=" + p.rows.consultation_threads[i],
          { cookies: authCookie(i) },
        );
        assert.equal(own.status, 200);
        assert.deepEqual(
          own.data.turns.map((x) => x.id),
          [p.rows.consultation_turns[i]],
        );
        assert.ok(own.data.turns[0].user_text.includes("架空"));
        assert.ok(own.data.turns[0].assistant_text.includes("合成"));
        assert.equal(
          (
            await api(
              "/api/consultations?thread=" + p.rows.consultation_threads[1 - i],
              { cookies: authCookie(i) },
            )
          ).status,
          404,
        );
      }
    },
  );
  await check(
    "05 unauthenticated and invalid-cookie application denial",
    async () => {
      const bad =
        "sb-ukdzggjfkcwjssjmnqim-auth-token=base64-" +
        Buffer.from(
          JSON.stringify({
            access_token: "invalid.jwt.value",
            refresh_token: "invalid",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString("base64url");
      for (const cookies of [undefined, bad])
        for (const route of [
          "/api/consultations",
          "/api/consultations?thread=" + p.rows.consultation_threads[0],
        ])
          assert.equal((await api(route, { cookies })).status, 401);
    },
  );
  await check(
    "06 anonymous diagnosis sessions isolated before claim",
    async () => {
      for (let i = 0; i < 2; i++) {
        assert.equal(
          (
            await api("/api/diagnoses?id=" + p.rows.diagnoses[i], {
              cookies: cookie(i),
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await api("/api/diagnoses?id=" + p.rows.diagnoses[1 - i], {
              cookies: cookie(i),
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await api("/api/diagnoses?id=" + p.rows.diagnoses[i], {
              cookies: cookie(2),
            })
          ).status,
          404,
        );
        for (const t of tables.slice(3)) {
          const v = await rest(t, { bearer: token(i) });
          assert.equal(v.status, 200);
          assert.deepEqual(v.data, []);
        }
      }
    },
  );
  await check("07 direct RPC denied to anon and both real users", async () => {
    for (const bearer of [undefined, token(0), token(1)])
      assert.ok(
        [401, 403].includes(
          (
            await rest("rpc/claim_anonymous_diagnoses", {
              method: "POST",
              bearer,
              body: { p_user: p.users[0], p_session: p.hashes[0] },
            })
          ).status,
        ),
      );
  });
  await check("08 CSRF and fabricated cookie cannot claim", async () => {
    assert.equal(
      (
        await api("/api/auth", {
          method: "POST",
          cookies: authCookie(0) + "; " + cookie(0),
          body: { action: "claim" },
          csrf: "https://attacker.invalid",
        })
      ).status,
      403,
    );
    const v = await claim(0, 2, { p_user: p.users[1], p_session: p.hashes[0] });
    assert.equal(v.status, 200);
    assert.equal(v.data.count, 0);
    assert.deepEqual(
      await owners(),
      Object.fromEntries(p.rows.diagnoses.map((id) => [id, null])),
    );
  });
  await check("09 A claims via real authenticated application", async () => {
    const v = await claim(0, 0, { p_user: p.users[1], p_session: p.hashes[1] });
    assert.equal(v.status, 200);
    assert.equal(v.data.count, 1);
    assert.deepEqual(await owners(), {
      [p.rows.diagnoses[0]]: p.users[0],
      [p.rows.diagnoses[1]]: null,
    });
  });
  await check(
    "10 concurrent A replay yields zero additional claims",
    async () => {
      const v = await Promise.all([claim(0), claim(0)]);
      assert.ok(v.every((x) => x.status === 200 && x.data.count === 0));
    },
  );
  await check("11 B claims via real authenticated application", async () => {
    const v = await claim(1, 1, { p_user: p.users[0], p_session: p.hashes[0] });
    assert.equal(v.status, 200);
    assert.equal(v.data.count, 1);
    assert.deepEqual(
      await owners(),
      Object.fromEntries(p.rows.diagnoses.map((id, i) => [id, p.users[i]])),
    );
  });
  await check(
    "12 replay and cross-account claim leave owners unchanged",
    async () => {
      for (const [i, j] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        const v = await claim(i, j);
        assert.equal(v.status, 200);
        assert.equal(v.data.count, 0);
      }
      assert.deepEqual(
        await owners(),
        Object.fromEntries(p.rows.diagnoses.map((id, i) => [id, p.users[i]])),
      );
    },
  );
  await check(
    "13 claimed diagnosis and children RLS, application and old-cookie denial",
    async () => {
      for (let i = 0; i < 2; i++) {
        for (const t of tables.slice(3)) {
          const v = await rest(t, { bearer: token(i) });
          assert.equal(v.status, 200);
          assert.deepEqual(v.data, [{ id: p.rows[t][i] }]);
        }
        assert.equal(
          (
            await api("/api/diagnoses?id=" + p.rows.diagnoses[i], {
              cookies: authCookie(i),
            })
          ).status,
          200,
        );
        for (const cookies of [cookie(i), authCookie(1 - i) + "; " + cookie(i)])
          assert.equal(
            (await api("/api/diagnoses?id=" + p.rows.diagnoses[i], { cookies }))
              .status,
            404,
          );
      }
    },
  );
  await check(
    "14 real user JWT owner PATCH denied; DB owner unchanged",
    async () => {
      for (let i = 0; i < 2; i++)
        for (const t of tables.slice(0, 4)) {
          const v = await rest(t, {
            method: "PATCH",
            bearer: token(i),
            filter: "id=eq." + p.rows[t][i],
            body: { user_id: p.users[1 - i] },
          });
          assert.ok([401, 403].includes(v.status));
          const current = await rest(t, {
            service: true,
            select: "id,user_id",
            filter: "id=eq." + p.rows[t][i],
          });
          assert.equal(current.status, 200);
          assert.deepEqual(current.data, [
            { id: p.rows[t][i], user_id: p.users[i] },
          ]);
        }
    },
  );
  fs.writeFileSync(
    path.join(dir, "completed.json"),
    JSON.stringify({
      passed: checks.length,
      checks,
      project: p.project,
      hosted: true,
      cleanupExecuted: false,
    }),
    { mode: 0o600, flag: "wx" },
  );
  fs.writeFileSync(path.join(dir, "stage"), "read-only", { mode: 0o600 });
  console.log(
    "STEP10 completed; fixtures retained. Post-state SQL verification still required.",
  );
} catch {
  stop(dir, "Live verification failed; inspect without retry");
  console.error("STEP10 stopped; no retry or cleanup performed");
  process.exitCode = 1;
}
