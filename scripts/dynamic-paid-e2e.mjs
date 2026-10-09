import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const origin = new URL(
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
const name = process.env.DYNAMIC_CASE ?? "enough";
const path = "../../work/dynamic-e2e/" + name + ".json";
const record = JSON.parse(await readFile(path, "utf8"));
const endpoint = "/api/diagnoses/" + record.id;
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
function check(r) {
  if (r.error) throw r.error;
  return r.data;
}
// These rows represent synthetic paid state only; no Stripe payment or real charge is created.
let payment = check(
  await db
    .from("payments")
    .select("id,status")
    .eq("diagnosis_id", record.id)
    .maybeSingle(),
);
if (!payment)
  payment = check(
    await db
      .from("payments")
      .insert({
        diagnosis_id: record.id,
        status: "paid",
        amount: 1980,
        currency: "jpy",
      })
      .select("id")
      .single(),
  );
check(
  await db
    .from("paid_reports")
    .upsert(
      { diagnosis_id: record.id, payment_id: payment.id },
      { onConflict: "diagnosis_id", ignoreDuplicates: true },
    ),
);
const answers = [
  "昨日は「落ち着いたら来週の日曜にお茶しない？」と送りました。",
  "相手から最後に「忙しいけど元気だよ、ありがとう」と言われました。",
  "来週日曜の午後なら空いています。相手にはまだ日程を聞いていません。",
  "返事がないと、続けて連絡したくなります。",
  "相手を応援しつつ、少し寂しいことを伝えたいです。",
];
await api(endpoint + "/report", {});
let state = await api(endpoint + "/report");
record.paid_questions = state.questions ?? [];
for (let i = 0; i < record.paid_questions.length; i++) {
  const q = record.paid_questions[i];
  if (state.answers.some((a) => a.question_key === q.question_key)) continue;
  const value = {
    paid_own: answers[0],
    paid_words: answers[1],
    paid_possible: answers[2],
    paid_impulse: answers[3],
    paid_tell: answers[4],
    paid_avoid: "返事を急かして気まずくなることを避けたいです。",
    paid_line: "短いけれど質問もあり、最後にありがとうと言ってくれました。",
  }[q.question_key];
  await api(endpoint + "/question-view", { key: q.question_key });
  await api(endpoint + "/answers", { key: q.question_key, answer: value });
  record.paid_answers ??= [];
  record.paid_answers.push({
    key: q.question_key,
    question: q.question_text,
    answer: value,
  });
  await writeFile(path, JSON.stringify(record, null, 2), { mode: 0o600 });
}
if (record.paid_questions.length) await api(endpoint + "/report", {});
state = await api(endpoint + "/report");
record.paid_report = state.report;
record.paid_status = state.status;
await writeFile(path, JSON.stringify(record, null, 2), { mode: 0o600 });
if (state.status !== "ready")
  throw new Error("paid report not ready: " + state.status);
console.log(
  "PASS",
  name,
  "paid questions",
  record.paid_questions.length,
  "report ready",
);
