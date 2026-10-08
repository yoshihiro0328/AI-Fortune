import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const fixtures = [];
const results = [];
async function account() {
  const email = "qa-http-" + randomUUID() + "@example.invalid",
    password = randomUUID() + "Aa!";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { test_fixture: true },
  });
  if (error) throw error;
  fixtures.push(data.user.id);
  const r = await fetch(base + "/api/auth", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ action: "login", email, password }),
  });
  assert.equal(r.status, 200, await r.text());
  return {
    id: data.user.id,
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
async function call(path, body, user) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(user ? { cookie: user.cookie } : {}),
      ...(body ? { origin: base, "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
try {
  const a = await account(),
    b = await account();
  assert.equal((await call("/api/consultations")).status, 401);
  assert.equal((await call("/api/billing")).status, 401);
  assert.equal((await call("/api/admin/analytics", undefined, a)).status, 403);
  results.push("anonymous/private/admin authorization");
  const subject = (
    await call(
      "/api/consultations",
      { action: "create_subject", nickname: "架空の恋人" },
      a,
    )
  ).data;
  const thread = (
    await call(
      "/api/consultations",
      { action: "create_thread", subject: subject.id },
      a,
    )
  ).data;
  assert.ok(thread.id);
  assert.equal(
    (await call("/api/consultations?thread=" + thread.id, undefined, b)).status,
    404,
  );
  const foreign = (
    await call(
      "/api/consultations",
      { action: "create_subject", nickname: "別ユーザー" },
      b,
    )
  ).data;
  assert.equal(
    (
      await call(
        "/api/consultations",
        { action: "move_thread", id: thread.id, target: foreign.id },
        a,
      )
    ).status,
    404,
  );
  results.push("subject creation and cross-user access denied");
  const texts = [
    "交際半年の恋人について。以前は返信が3時間以内だったのに、今は翌日です。会う頻度は週1回のまま。気持ちが離れたのか不安です。",
    "昨日は相手から「日曜日空いてる？」とLINEが来ました。私は会いたいです。短い返信文を考えてください。",
    "日曜の予定が決まりました。まずは楽しんで、連絡の頻度は会ったときに話すつもりです。",
  ];
  const answers = [];
  for (const text of texts) {
    const requestId = randomUUID();
    const r = await call(
      "/api/consultations/" + thread.id + "/send",
      { requestId, text },
      a,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    answers.push(r.data.turn);
    const retry = await call(
      "/api/consultations/" + thread.id + "/send",
      { requestId, text },
      a,
    );
    assert.equal(retry.data.turn.assistant_text, r.data.turn.assistant_text);
    console.log("chat success", answers.length);
  }
  let h = (await call("/api/consultations", undefined, a)).data;
  assert.equal(h.usage.used, 3);
  assert.equal(h.usage.remaining, 0);
  assert.ok(h.subjects[0].memory.length);
  results.push("3 real AI exchanges, exact retries, quota and memory");
  const fourth = await call(
    "/api/consultations/" + thread.id + "/send",
    {
      requestId: randomUUID(),
      text: "暴力はないです。日曜に着ていく服で迷っています。",
    },
    a,
  );
  assert.equal(fourth.status, 409);
  results.push(
    "free fourth exchange denied, negated violence not paywall bypass",
  );
  const risk = await call(
    "/api/consultations/" + thread.id + "/send",
    {
      requestId: randomUUID(),
      text: "今、相手に殴られて怖い。まだ同じ部屋にいます。",
    },
    a,
  );
  assert.equal(risk.status, 200, JSON.stringify(risk.data));
  assert.equal(risk.data.turn.safety, true);
  assert.equal(risk.data.usage.used, 3);
  results.push("safety works over quota without charge");
  const last = answers.at(-1),
    regenerationId = randomUUID();
  const regenInput = {
    requestId: last.id,
    text: last.user_text,
    regenerate: true,
    regenerationId,
  };
  const regen = await call(
    "/api/consultations/" + thread.id + "/send",
    regenInput,
    a,
  );
  assert.equal(regen.status, 200, JSON.stringify(regen.data));
  assert.equal(regen.data.usage.used, 3);
  const replay = await call(
    "/api/consultations/" + thread.id + "/send",
    regenInput,
    a,
  );
  assert.equal(replay.data.turn.assistant_text, regen.data.turn.assistant_text);
  results.push("regeneration is idempotent and free");
  const history = await call(
    "/api/consultations?thread=" + thread.id,
    undefined,
    a,
  );
  assert.equal(history.data.turns.length, 4);
  results.push("history reload");
  const second = (
    await call(
      "/api/consultations",
      { action: "create_subject", nickname: "架空の友人" },
      a,
    )
  ).data;
  assert.equal(
    (
      await call(
        "/api/consultations",
        { action: "move_thread", id: thread.id, target: second.id },
        a,
      )
    ).status,
    200,
  );
  const moved = (
    await call("/api/consultations?thread=" + thread.id, undefined, a)
  ).data;
  assert.equal(moved.subject.id, second.id);
  h = (await call("/api/consultations", undefined, a)).data;
  assert.ok(h.subjects.every((s) => s.memory.length === 0));
  results.push("subject move clears both memories");
  await call(
    "/api/consultations",
    {
      action: "memory",
      id: second.id,
      notes: ["これは友人についての相談です。"],
    },
    a,
  );
  await call(
    "/api/consultations",
    { action: "memory", id: second.id, notes: [] },
    a,
  );
  await call(
    "/api/consultations",
    { action: "delete_thread", id: thread.id },
    a,
  );
  assert.equal(
    (await call("/api/consultations?thread=" + thread.id, undefined, a)).status,
    404,
  );
  h = (await call("/api/consultations", undefined, a)).data;
  assert.equal(h.usage.used, 3);
  results.push("memory deletion and history deletion preserve quota ledger");
  const unauthorizedOrigin = await fetch(base + "/api/consultations", {
    method: "POST",
    headers: {
      origin: "https://attacker.invalid",
      "content-type": "application/json",
      cookie: a.cookie,
    },
    body: JSON.stringify({ action: "create_subject", nickname: "bad" }),
  });
  assert.equal(unauthorizedOrigin.status, 403);
  results.push("CSRF denied");
  const anonymous = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const direct = await anonymous.from("consultation_subjects").select("*");
  assert.ok(direct.error || direct.data.length === 0);
  results.push("direct anonymous Data API denied");
  await mkdir("../../work", { recursive: true });
  await writeFile(
    "../../work/continuation-http-evidence.json",
    JSON.stringify({ base, results, answers }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, checks: results.length }));
} finally {
  // Remove only disposable fixture content. No real account or payment data is touched.
  for (const id of fixtures) {
    await admin.from("consultation_subjects").delete().eq("user_id", id);
    await admin.from("analytics_events").delete().eq("user_id", id);
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) console.error("Fixture cleanup pending", id);
  }
}
