/** Actual Next HTTP + Supabase SDK + PostgREST + Docker PostgreSQL.
 * Only Auth, Turnstile and OpenAI responses are synthetic. No hosted services.
 * All resources are uniquely named and removed in finally, including on failure.
 */
import assert from "node:assert/strict";
import { step10Isolated } from "./step10-isolated.mjs";
import { preparation } from "./step10-prepare.mjs";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
// Refuse inherited live flags/credentials and Next's implicit .env loading.
preparation(["--plan"], process.env);
if (
  readdirSync(root).some(
    (name) => name.startsWith(".env") && name !== ".env.example",
  )
)
  throw new Error("Isolated integration refuses real .env files");
const temp = mkdtempSync(path.join(tmpdir(), "yorisoi-integration-"));
const prefix = `yorisoi-integration-${process.pid}`;
const pg = prefix + "-db",
  rest = prefix + "-rest",
  network = prefix + "-net",
  httpNetwork = prefix + "-http";
const origin = `http://127.0.0.1:${process.env.PHASE6_HTTP_PORT || 5197}`;
const jwtSecret = randomBytes(40).toString("hex");
const sessionSecret = randomBytes(32).toString("hex");
const cleanupSecret = randomBytes(32).toString("hex");
const checks = [];
let server,
  output = "",
  restURL,
  serviceToken,
  anonToken;
const mockFile = path.join(temp, "state.json"),
  eventsFile = path.join(temp, "events.txt");
let mock = { mode: "success", users: {} };
function setMock(patch) {
  mock = { ...mock, ...patch };
  writeFileSync(mockFile + ".new", JSON.stringify(mock), { mode: 0o600 });
  renameSync(mockFile + ".new", mockFile);
}
function eventCount(name) {
  return readFileSync(eventsFile, "utf8")
    .split("\n")
    .filter((v) => v === name).length;
}
function command(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...options });
  if (r.status !== 0)
    throw new Error(
      `${cmd} failed (${r.status}): ${(r.stderr || "").slice(-1000)}`,
    );
  return r.stdout.trim();
}
function docker(...args) {
  return command("docker", args);
}
function sql(query, database = "http_test", role = "postgres") {
  return command(
    "docker",
    [
      "exec",
      "-i",
      pg,
      "psql",
      "-h",
      "/tmp",
      "-U",
      role,
      "-d",
      database,
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query },
  );
}
function object(query, database) {
  return JSON.parse(sql(query, database).split("\n").at(-1));
}
function jwt(role, sub) {
  const data = [
    { alg: "HS256", typ: "JWT" },
    {
      role,
      sub,
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  ]
    .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
    .join(".");
  return (
    data +
    "." +
    createHmac("sha256", jwtSecret).update(data).digest("base64url")
  );
}
function authCookie(user, badSignature = false) {
  let token = jwt("authenticated", user.id);
  if (badSignature) token = token.slice(0, -4) + "fake";
  return (
    "sb-127-auth-token=base64-" +
    Buffer.from(
      JSON.stringify({
        access_token: token,
        refresh_token: "synthetic-only",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user,
      }),
    ).toString("base64url")
  );
}
async function request(
  route,
  {
    method = "GET",
    data,
    cookie,
    originHeader = origin,
    ip = "192.0.2.1",
    headers = {},
  } = {},
) {
  const r = await fetch(origin + route, {
    method,
    headers: {
      origin: originHeader,
      "content-type": "application/json",
      "x-vercel-forwarded-for": ip,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const text = await r.text();
  return {
    status: r.status,
    headers: r.headers,
    data: text ? JSON.parse(text) : null,
  };
}
async function test(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS " + name);
}
let ipNumber = 10;
async function session(options = {}) {
  const r = await request("/api/trial/session", {
    method: "POST",
    data: { consentVersion: "trial-2026-10-15", challengeToken: randomUUID() },
    ip: `192.0.2.${++ipNumber}`,
    ...options,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { cookie: r.headers.get("set-cookie").split(";")[0], response: r };
}
const intake = () => ({
  requestId: randomUUID(),
  topicId: "reply",
  topicVersion: 1,
  text: "合成相談本文：返信の言い方を考えたいです。",
  fields: { received: "最近どう？" },
});
const send = (s, data = intake()) =>
  request("/api/trial/turns", { method: "POST", cookie: s.cookie, data });
const hash = (s) =>
  createHmac("sha256", sessionSecret)
    .update(s.cookie.split("=")[1])
    .digest("hex");
const reset = () => {
  sql(
    "update trial_private.settings set enabled=true,cleaned_at=now(),daily_nusd=3000000000;update trial_private.prices set input_nusd=125,output_nusd=500,valid_until=now()+interval '1 day'",
  );
  setMock({ mode: "success", delay: 0, challenge: "accept" });
};
async function waitUntil(fn) {
  for (let i = 0; i < 120; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Readiness timeout");
}
try {
  docker("network", "create", "--internal", network);
  docker("network", "create", httpNetwork);
  docker(
    "run",
    "-d",
    "--name",
    pg,
    "--network",
    network,
    "--user",
    "postgres",
    "--entrypoint",
    "sh",
    "public.ecr.aws/supabase/postgres:17.11.0.004",
    "-c",
    "initdb -D /tmp/phase6-data -U platform_admin --auth=trust >/dev/null && echo 'host all all all trust' >> /tmp/phase6-data/pg_hba.conf && exec postgres -D /tmp/phase6-data -k /tmp -h '*' -c log_statement=none -c log_min_error_statement=panic",
  );
  await waitUntil(
    () =>
      spawnSync(
        "docker",
        ["exec", pg, "pg_isready", "-h", "/tmp", "-U", "postgres"],
        { stdio: "ignore" },
      ).status === 0,
  );
  // Separate bootstrap superuser from the non-superuser Supabase migration owner.
  sql(
    "create role postgres login superuser;alter database postgres owner to postgres;",
    "postgres",
    "platform_admin",
  );
  const dbResults = JSON.parse(
    command("python3", ["scripts/phase6/docker-verify.py"], {
      env: { ...process.env, PHASE6_TEST_CONTAINER: pg },
    }),
  );
  writeFileSync(
    path.join(temp, "docker-summary.json"),
    JSON.stringify(dbResults, null, 2),
  );
  console.log(
    "PASS Docker migrations, races, budget and ACL-preserving restore",
  );
  sql("create database http_test;", "postgres");
  sql(
    readFileSync(path.join(root, "scripts/phase6/auth-bootstrap.sql"), "utf8"),
    "http_test",
    "platform_admin",
  );
  for (const f of readdirSync(path.join(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql(readFileSync(path.join(root, "supabase/migrations", f), "utf8"));
  // Authenticator has no table privileges and can switch only to the three API roles.
  sql(
    "create role http_authenticator login noinherit; grant anon,authenticated,service_role to http_authenticator;",
    "http_test",
    "platform_admin",
  );
  serviceToken = jwt("service_role");
  anonToken = jwt("anon");
  const envFile = path.join(temp, "postgrest.env");
  writeFileSync(
    envFile,
    `PGRST_DB_URI=postgres://http_authenticator@${pg}:5432/http_test\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${jwtSecret}\nPGRST_LOG_LEVEL=crit\nPGRST_SERVER_HOST=0.0.0.0\n`,
    { mode: 0o600 },
  );
  docker(
    "run",
    "-d",
    "--name",
    rest,
    "--network",
    httpNetwork,
    "-p",
    "127.0.0.1::3000",
    "--env-file",
    envFile,
    "postgrest/postgrest:v13.0.0",
  );
  docker("network", "connect", network, rest);
  try {
    restURL = "http://" + docker("port", rest, "3000/tcp").split("\n")[0];
  } catch {
    throw new Error(
      "PostgREST startup: " +
        docker("logs", rest) +
        docker(
          "inspect",
          "--format",
          "{{json .State}} {{json .HostConfig.PortBindings}} {{json .NetworkSettings.Ports}}",
          rest,
        ),
    );
  }
  try {
    await waitUntil(async () => {
      try {
        return (await fetch(restURL, { signal: AbortSignal.timeout(1500) })).ok;
      } catch {
        return false;
      }
    });
  } catch {
    throw new Error(
      "PostgREST readiness: " +
        command("docker", ["logs", rest]) +
        sql(
          "select coalesce(string_agg(usename||':'||state,','),'none') from pg_stat_activity where datname='http_test'",
        ),
    );
  }
  console.log("PASS PostgREST ready");
  reset();
  writeFileSync(eventsFile, "", { mode: 0o600 });
  const users = [true, true, false].map((confirmed, index) => ({
    id: randomUUID(),
    aud: "authenticated",
    role: "authenticated",
    email: `synthetic-${index}@example.invalid`,
    email_confirmed_at: confirmed ? new Date().toISOString() : null,
  }));
  setMock({ users: Object.fromEntries(users.map((u) => [u.id, u])) });
  for (const u of users)
    sql(
      `insert into auth.users(id,email_confirmed_at) values('${u.id}',${u.email_confirmed_at ? "now()" : "null"});`,
    );
  const [owner, other, unconfirmed] = users;
  const childEnv = {
    PATH: process.env.PATH,
    HOME: temp,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${path.join(root, "scripts/phase6/mock-providers.mjs")}`,
    PHASE6_MOCK_STATE: mockFile,
    PHASE6_MOCK_EVENTS: eventsFile,
    PHASE6_REST_URL: restURL,
    PHASE6_JWT_SECRET: jwtSecret,
    NEXT_PUBLIC_APP_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonToken,
    SUPABASE_SERVICE_ROLE_KEY: serviceToken,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    TRIAL_SESSION_SECRET: sessionSecret,
    TRIAL_ABUSE_SECRET: randomBytes(32).toString("hex"),
    TRIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TRIAL_CLEANUP_SECRET: cleanupSecret,
    TRIAL_ENABLED: "true",
    TRIAL_ENVIRONMENT: "sandbox",
    STRIPE_MODE: "sandbox",
    STRIPE_ACCOUNT_ID: sql(
      "select stripe_account_id from public.payment_environment",
    ),
    STRIPE_LIVE_CHECKOUT_ENABLED: "false",
    PUBLIC_INDEXING_ENABLED: "false",
    TRIAL_RETENTION_VERIFIED: "true",
    TRIAL_BUDGET_VERIFIED: "true",
    TRIAL_OPENAI_PROJECT_ID: "proj_synthetic",
    TRIAL_OPENAI_API_KEY: "synthetic-not-a-key",
    TRIAL_TURNSTILE_SECRET: "synthetic-not-a-key",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "preview",
    VERCEL_PROJECT_ID: "local-isolated-integration",
    PREVIEW_DEMO_ENABLED: "false",
  };
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      new URL(origin).port,
    ],
    { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (b) => (output += b));
  server.stderr.on("data", (b) => (output += b));
  await waitUntil(async () => {
    if (server.exitCode !== null) throw new Error("Next server exited");
    try {
      return (await request("/api/trial/session")).status === 200;
    } catch {
      return false;
    }
  });
  const ownership = await step10Isolated({
    sql,
    object,
    request,
    restURL,
    jwt,
    authCookie,
    users,
    sessionSecret: childEnv.SESSION_SECRET,
    eventCount,
  });
  reset();
  sql(
    `insert into public.billing_customers(user_id,stripe_customer_id) values('${other.id}','cus_synthetic');`,
  );
  sql(
    `insert into public.subscriptions(id,user_id,stripe_customer_id,price_version,amount,status,period_start,period_end,paid_through,is_test,created_at) values('sub_synthetic','${other.id}','cus_synthetic','plus-2026-10-980',980,'active',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days',true,now());`,
  );
  for (const amount of [1980, 980])
    sql(
      `with d as (insert into public.diagnoses(user_id,anonymous_session_id,diagnosis_type_id) values('${owner.id}','synthetic',(select id from public.diagnosis_types limit 1)) returning id) insert into public.payments(user_id,diagnosis_id,amount,status) select '${owner.id}',id,${amount},'paid' from d;`,
    );
  const regressionQuery =
    "select jsonb_build_object('payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p),'subscriptions',(select jsonb_agg(to_jsonb(s) order by id) from public.subscriptions s),'settings',(select to_jsonb(s) from public.service_settings s));";
  const baseline = object(regressionQuery);
  await test("01 HTTP session / secure cookie / 24h retention", async () => {
    const s = await session();
    const cookie = s.response.headers.get("set-cookie");
    for (const part of [
      "HttpOnly",
      "Secure",
      "SameSite=strict",
      "Max-Age=86400",
      "Path=/",
    ])
      assert.ok(cookie.includes(part), part);
    assert.equal(s.response.headers.get("cache-control"), "private, no-store");
    assert.ok(
      Math.abs(Date.parse(s.response.data.expiresAt) - Date.now() - 86400000) <
        5000,
    );
  });
  await test("02 CSRF rejects all four mutations before challenge/DB", async () => {
    for (const originHeader of ["", "https://attacker.invalid"])
      for (const [route, method] of [
        ["/api/trial/session", "POST"],
        ["/api/trial/turns", "POST"],
        ["/api/trial/claim", "POST"],
        ["/api/trial/session/content", "DELETE"],
      ]) {
        const before = eventCount("database");
        assert.equal(
          (await request(route, { method, originHeader, data: {} })).status,
          403,
        );
        assert.equal(eventCount("database"), before);
      }
  });
  let saved, data;
  await test("03 duplicate concurrency / encrypted storage / refresh / body conflict", async () => {
    saved = await session();
    data = intake();
    setMock({ delay: 350 });
    const before = eventCount("generation");
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => send(saved, data)),
    );
    assert.equal(responses.filter((r) => r.status === 200).length, 1);
    assert.ok(
      responses.filter((r) => r.status !== 200).every((r) => r.status === 409),
    );
    assert.equal(eventCount("generation") - before, 1);
    setMock({ delay: 0 });
    const raw = object(
      `select to_jsonb(t) from trial_private.turns t join trial_private.sessions s on s.id=t.session_id where s.token_hash='${hash(saved)}'`,
    );
    assert.ok(raw.payload && !raw.payload.includes(data.text));
    assert.ok(!raw.answer.includes("合成回答"));
    assert.equal((await send(saved, data)).status, 200);
    assert.equal(eventCount("generation") - before, 1);
    assert.equal(
      (await send(saved, { ...data, text: "変更された合成本文" })).status,
      409,
    );
    const read = await request("/api/trial/session", { cookie: saved.cookie });
    assert.ok(read.data.turn.answer.includes("合成回答"));
    assert.equal(read.data.remaining, 0);
    const cost = object(
      "select to_jsonb(c) from trial_private.calls c order by created_at desc limit 1",
    );
    assert.equal(cost.settled_nusd, 75000);
    assert.equal(cost.reserved_nusd, 1950000);
  });
  await test("04 forged and independent cookies cannot read/delete/claim owner data", async () => {
    const foreign = await session();
    const fake = { cookie: "yorisoi_trial=" + "x".repeat(43) };
    for (const s of [foreign, fake]) {
      const read = await request("/api/trial/session", { cookie: s.cookie });
      assert.ok(!read.data.turn?.answer);
      assert.ok(
        [200, 410].includes(
          (
            await request("/api/trial/session/content", {
              method: "DELETE",
              cookie: s.cookie,
            })
          ).status,
        ),
      );
      const claim = await request("/api/trial/claim", {
        method: "POST",
        cookie: s.cookie + "; " + authCookie(other),
        data: { consent: true, expectedEmail: other.email },
      });
      assert.ok([409, 410].includes(claim.status));
    }
    assert.ok(
      (await request("/api/trial/session", { cookie: saved.cookie })).data.turn
        .answer,
    );
  });
  await test("05 verified identity / email consent / concurrent cross-owner claim / history", async () => {
    const approval = { consent: true, expectedEmail: owner.email };
    for (const cookie of [
      saved.cookie,
      saved.cookie + "; " + authCookie(unconfirmed),
      saved.cookie + "; " + authCookie(owner, true),
    ])
      assert.equal(
        (
          await request("/api/trial/claim", {
            method: "POST",
            cookie,
            data: approval,
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await request("/api/trial/claim", {
          method: "POST",
          cookie: saved.cookie + "; " + authCookie(owner),
          data: { ...approval, expectedEmail: other.email },
        })
      ).status,
      403,
    );
    // Client-supplied identity/verification fields must never override getUser().
    for (const extra of [
      { user_id: other.id },
      { p_user: other.id },
      { email_confirmed_at: "2099-01-01" },
    ]) {
      assert.equal(
        (
          await request("/api/trial/claim", {
            method: "POST",
            cookie: saved.cookie + "; " + authCookie(owner),
            data: { ...approval, ...extra },
          })
        ).status,
        422,
      );
    }
    // A stale verified Auth response must still fail against the current DB truth.
    sql(`update auth.users set email_confirmed_at=null where id='${owner.id}'`);
    assert.equal(
      (
        await request("/api/trial/claim", {
          method: "POST",
          cookie: saved.cookie + "; " + authCookie(owner),
          data: approval,
        })
      ).status,
      401,
    );
    assert.equal(sql("select count(*) from public.consultation_threads"), "0");
    sql(
      `update auth.users set email_confirmed_at=now() where id='${owner.id}'`,
    );
    const r = await Promise.all(
      [owner, other].map((u) =>
        request("/api/trial/claim", {
          method: "POST",
          cookie: saved.cookie + "; " + authCookie(u),
          data: { consent: true, expectedEmail: u.email },
        }),
      ),
    );
    assert.deepEqual(r.map((x) => x.status).sort(), [200, 403]);
    const winner = r[0].status === 200 ? owner : other,
      loser = winner === owner ? other : owner;
    const thread = r.find((x) => x.status === 200).data.threadId;
    const replay = await request("/api/trial/claim", {
      method: "POST",
      cookie: saved.cookie + "; " + authCookie(winner),
      data: { consent: true, expectedEmail: winner.email },
    });
    assert.equal(replay.data.threadId, thread);
    const history = await request("/api/consultations?thread=" + thread, {
      cookie: authCookie(winner),
    });
    assert.equal(history.status, 200);
    assert.equal(history.data.turns.length, 1);
    assert.ok(history.data.turns[0].user_text.includes(data.text));
    assert.ok(history.data.turns[0].user_text.includes("最近どう？"));
    assert.equal(
      (
        await request("/api/consultations?thread=" + thread, {
          cookie: authCookie(loser),
        })
      ).status,
      404,
    );
    assert.equal(
      sql("select count(*) from public.consultation_turns where charged"),
      "0",
    );
    assert.equal(
      sql(
        `select count(*) from trial_private.turns t join trial_private.sessions s on s.id=t.session_id where s.token_hash='${hash(saved)}' and (payload is not null or answer is not null)`,
      ),
      "0",
    );
    for (const u of [owner, other]) {
      const e = object(`select public.consultation_entitlement('${u.id}')`);
      assert.equal(e.remaining, u === owner ? 3 : 30);
      assert.equal(e.used, 0);
    }
  });
  await test("06 HTTP PostgREST JWT / RLS / browser RPC and write denial", async () => {
    for (const token of [anonToken, jwt("authenticated", owner.id)]) {
      const r = await fetch(restURL + "/rpc/trial_policy", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.ok([401, 403].includes(r.status));
      const write = await fetch(restURL + "/consultation_subjects", {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_id: owner.id, nickname: "forbidden" }),
      });
      assert.ok([401, 403].includes(write.status));
    }
    const rows = await (
      await fetch(restURL + "/consultation_threads", {
        headers: {
          authorization: "Bearer " + jwt("authenticated", unconfirmed.id),
        },
      })
    ).json();
    assert.deepEqual(rows, []);
    assert.equal(
      (
        await fetch(restURL + "/consultation_threads", {
          headers: { authorization: "Bearer forged" },
        })
      ).status,
      401,
    );
  });
  await test("07 owner deletion / no quota reset / idempotent delete", async () => {
    const s = await session();
    assert.equal((await send(s)).status, 200);
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await request("/api/trial/session/content", {
            method: "DELETE",
            cookie: s.cookie,
          })
        ).status,
        200,
      );
    const r = await request("/api/trial/session", { cookie: s.cookie });
    assert.ok(!r.data.turn?.answer);
    assert.equal(r.data.remaining, 0);
    const before = sql("select count(*) from public.consultation_threads");
    assert.equal(
      (
        await request("/api/trial/claim", {
          method: "POST",
          cookie: s.cookie + "; " + authCookie(owner),
          data: { consent: true, expectedEmail: owner.email },
        })
      ).status,
      409,
    );
    assert.equal(
      sql("select count(*) from public.consultation_threads"),
      before,
    );
  });
  await test("08 expiry cannot read/send/claim; maintenance auth / purge", async () => {
    const s = await session();
    assert.equal((await send(s)).status, 200);
    sql(
      `update trial_private.sessions set expires_at=now()-interval '1 second' where token_hash='${hash(s)}'`,
    );
    const r = await request("/api/trial/session", { cookie: s.cookie });
    assert.equal(r.data.active, false);
    assert.ok(!r.data.turn);
    assert.equal((await send(s)).status, 410);
    assert.equal(
      (
        await request("/api/trial/claim", {
          method: "POST",
          cookie: s.cookie + "; " + authCookie(owner),
          data: { consent: true, expectedEmail: owner.email },
        })
      ).status,
      410,
    );
    assert.equal((await request("/api/cron/trial")).status, 401);
    assert.equal(
      (
        await request("/api/cron/trial", {
          headers: { authorization: "Bearer " + cleanupSecret },
        })
      ).status,
      200,
    );
    assert.equal(
      sql(
        `select count(*) from trial_private.sessions where token_hash='${hash(s)}'`,
      ),
      "0",
    );
  });
  await test("09 rate limit across replaced cookies / challenge replay", async () => {
    const ip = "198.51.100.8",
      challengeToken = randomUUID();
    await session({
      ip,
      data: { consentVersion: "trial-2026-10-15", challengeToken },
    });
    assert.equal(
      (
        await request("/api/trial/session", {
          method: "POST",
          ip,
          data: { consentVersion: "trial-2026-10-15", challengeToken },
        })
      ).status,
      403,
    );
    const limit = Number(
      sql("select ip_hour_limit from trial_private.settings"),
    );
    for (let i = 1; i < limit; i++) await session({ ip });
    const r = await request("/api/trial/session", {
      method: "POST",
      ip,
      data: {
        consentVersion: "trial-2026-10-15",
        challengeToken: randomUUID(),
      },
    });
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "3600");
  });
  await test("10 no-send release / uncertain charge retained / retry / invalid output", async () => {
    for (const mode of ["oversize", "timeout", "invalid"]) {
      reset();
      const s = await session();
      const d = intake();
      setMock({ mode });
      assert.equal((await send(s, d)).status, 503);
      const c = object(
        "select to_jsonb(c) from trial_private.calls c order by created_at desc limit 1",
      );
      assert.equal(
        c.settled_nusd,
        mode === "oversize" ? 0 : mode === "invalid" ? 75000 : null,
      );
      assert.equal(
        c.status,
        mode === "oversize"
          ? "released"
          : mode === "invalid"
            ? "settled"
            : "uncertain",
      );
      setMock({ mode: "success" });
      assert.equal((await send(s, d)).status, 200);
    }
  });
  await test("11 $3 cap HTTP concurrency rejects excess before provider", async () => {
    reset();
    const sessions = await Promise.all(
      Array.from({ length: 10 }, () => session()),
    );
    sql("update trial_private.prices set input_nusd=50000,output_nusd=281250");
    setMock({ delay: 500 });
    const before = eventCount("generation");
    const r = await Promise.all(sessions.map((s) => send(s)));
    assert.ok(r.some((x) => x.status === 503));
    assert.ok(r.every((x) => [200, 503].includes(x.status)));
    assert.ok(eventCount("generation") - before <= 3);
    assert.ok(
      Number(
        sql(
          "select sum(coalesce(settled_nusd,reserved_nusd)) from trial_private.calls",
        ),
      ) <= 3000000000,
    );
    reset();
  });
  await test("12 stale price / cleanup heartbeat / anomaly stop generation", async () => {
    const s = await session();
    sql(
      "update trial_private.prices set valid_until=now()-interval '1 second'",
    );
    let before = eventCount("generation");
    assert.equal((await send(s)).status, 503);
    assert.equal(eventCount("generation"), before);
    reset();
    sql(
      "update trial_private.settings set cleaned_at=now()-interval '11 minutes'",
    );
    assert.equal(
      (
        await request("/api/cron/trial/health", {
          headers: { authorization: "Bearer " + cleanupSecret },
        })
      ).status,
      503,
    );
    assert.equal((await send(s)).status, 503);
    assert.equal(eventCount("generation"), before);
    assert.equal(
      (
        await request("/api/cron/trial", {
          headers: { authorization: "Bearer " + cleanupSecret },
        })
      ).status,
      200,
    );
    assert.equal(sql("select enabled from trial_private.settings"), "f");
    reset();
    setMock({ mode: "anomaly" });
    assert.equal((await send(s)).status, 503);
    assert.equal(sql("select enabled from trial_private.settings"), "f");
    reset();
  });
  await test("13 in-flight expiry and delete never resurrect content", async () => {
    for (const action of ["expiry", "delete"]) {
      const s = await session();
      setMock({ delay: 700 });
      const before = eventCount("generation");
      const pending = send(s);
      await waitUntil(() => eventCount("generation") > before);
      if (action === "expiry")
        sql(
          `update trial_private.sessions set expires_at=now()-interval '1 second' where token_hash='${hash(s)}'`,
        );
      else
        assert.equal(
          (
            await request("/api/trial/session/content", {
              method: "DELETE",
              cookie: s.cookie,
            })
          ).status,
          200,
        );
      assert.equal((await pending).status, 410);
      setMock({ delay: 0 });
      assert.ok(
        !(await request("/api/trial/session", { cookie: s.cookie })).data.turn
          ?.answer,
      );
    }
  });
  await test("14 database loss fails closed without provider generation", async () => {
    const s = await session();
    docker("stop", rest);
    const before = eventCount("generation");
    assert.equal((await send(s)).status, 503);
    assert.equal(eventCount("generation"), before);
  });
  await test("15 legacy purchases / Plus / free quota / no outbound leak", async () => {
    assert.deepEqual(object(regressionQuery), baseline);
    assert.equal(eventCount("blocked"), 0);
    for (const secret of [
      jwtSecret,
      sessionSecret,
      cleanupSecret,
      serviceToken,
      anonToken,
      childEnv.TRIAL_ENCRYPTION_KEY,
      data.text,
      owner.email,
    ])
      assert.ok(!output.includes(secret), "sensitive value in server log");
    assert.ok(!/unhandledRejection|uncaughtException/.test(output));
  });
  await test("16 review project demo OFF blocks all real routes at HTTP boundary", async () => {
    server.kill("SIGTERM");
    await new Promise((resolve) =>
      server.exitCode !== null ? resolve() : server.once("exit", resolve),
    );
    const before = eventCount("database");
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        new URL(origin).port,
      ],
      {
        cwd: root,
        env: {
          ...childEnv,
          VERCEL_PROJECT_ID: "prj_oBNCS3yHBdYmvCuSKC4pnhcoypp6",
          PREVIEW_DEMO_ENABLED: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (b) => (output += b));
    server.stderr.on("data", (b) => (output += b));
    await waitUntil(async () => {
      try {
        return (await request("/api/trial/session")).status === 503;
      } catch {
        return false;
      }
    });
    for (const route of [
      "/api/trial/session",
      "/api/trial/turns",
      "/api/trial/claim",
      "/api/auth",
      "/auth/callback",
      "/api/consultations",
      "/api/webhooks/stripe",
      "/api/cron/trial",
      "/plans",
      "/account",
    ]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const r = await request(route, { method });
        assert.equal(r.status, 503);
        assert.equal(r.data.error, "REVIEW_DISABLED");
        assert.ok(r.headers.get("x-robots-tag").includes("noindex"));
      }
    }
    assert.equal(eventCount("database"), before);
  });
  const report = {
    docker: dbResults,
    ownership,
    http: {
      passed: checks.length,
      checks,
      externalCalls: 0,
      auth: "signed synthetic token + mocked getUser; real Supabase Auth/email NOT tested",
      transport: "real Next HTTP, Supabase SDK, PostgREST 13, PostgreSQL 17",
    },
    providers: {
      count: eventCount("count"),
      generation: eventCount("generation"),
      allMocked: true,
    },
    legacyDataUnchanged: true,
  };
  const outputPath = process.env.PHASE6_REPORT_PATH;
  if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((resolve) =>
      server.exitCode !== null ? resolve() : server.once("exit", resolve),
    );
  }
  for (const name of [rest, pg])
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  spawnSync("docker", ["network", "rm", network, httpNetwork], {
    stdio: "ignore",
  });
  rmSync(temp, { recursive: true, force: true });
}
