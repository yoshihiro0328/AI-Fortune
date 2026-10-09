import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100",
  origin = new URL(
    process.env.TEST_ORIGIN ??
      (process.env.TEST_BASE_URL?.startsWith("https://")
        ? base
        : process.env.NEXT_PUBLIC_APP_URL),
  ).origin;
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const file = "../../work/dynamic-e2e/v1-baseline.json";
let record;
try {
  record = JSON.parse(await readFile(file, "utf8"));
} catch {
  record = { steps: [] };
}
const save = () =>
  writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 });
function checked(r) {
  if (r.error) throw r.error;
  return r.data;
}
if (!record.id) {
  const token = randomBytes(32).toString("base64url");
  record.cookie = "yorisoi_session=" + token;
  const type = checked(
    await db
      .from("diagnosis_types")
      .select("id")
      .eq("slug", "partner-mind")
      .single(),
  );
  record.id = checked(
    await db
      .from("diagnoses")
      .insert({
        diagnosis_type_id: type.id,
        anonymous_session_id: createHmac("sha256", process.env.SESSION_SECRET)
          .update(token)
          .digest("hex"),
      })
      .select("id")
      .single(),
  ).id;
  await save();
}
async function api(path, data) {
  const r = await fetch(base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      origin,
      cookie: record.cookie,
      "content-type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(r.status + " " + j.error);
  return j;
}
const answers = {
  relationship: "交際中",
  duration: "半年〜1年",
  last_meeting: "1週間以内",
  contact: "週に数回",
  reply_change: "少し遅くなった",
  initiative: "同じくらい",
  next_meeting: "まだ予定はない",
  behavior:
    "ここ2週間、返信が翌日になることが増えました。会うと普段通りで、何が変わったのか気になります。",
  concern: "返信が遅くなったことが気になります。",
  goal: "相手の気持ちを決めつけず、無理なく会って話せる関係になりたいです。",
};
const legacy = await api("/api/questions");
let state = await api("/api/diagnoses/" + record.id);
for (const q of legacy) {
  if (!state.answers.some((a) => a.question_key === q.question_key))
    await api("/api/diagnoses/" + record.id + "/answers", {
      key: q.question_key,
      answer: answers[q.question_key],
    });
}
for (let i = 0; i < 3; i++) {
  state = await api("/api/diagnoses/" + record.id);
  if (state.free_report) break;
  for (const q of state.followup) {
    if (!state.answers.some((a) => a.question_key === q.question_key)) {
      const answer =
        "相手は最近忙しそうですが、詳しくはまだ聞いていません。会うと普段通り話せます。";
      await api("/api/diagnoses/" + record.id + "/answers", {
        key: q.question_key,
        answer,
      });
      record.steps.push({ question: q.question_text, answer });
    }
  }
  await api("/api/diagnoses/" + record.id + "/analyze", {});
}
state = await api("/api/diagnoses/" + record.id);
record.report = state.free_report;
record.count = state.answers.length;
await save();
if (!record.report) throw new Error("v1 incomplete");
console.log("PASS v1", record.count, "questions, legacy report visible");
