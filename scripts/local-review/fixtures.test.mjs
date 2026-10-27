import test from "node:test";
import assert from "node:assert/strict";
import { createFixture } from "./fixtures.mjs";
const url = (p) => new URL(p, "http://127.0.0.1:5318");
test("real component shapes, scenario transitions, and blocked external effects", () => {
  const f = createFixture(process.cwd());
  for (const mode of ["free", "plus", "canceled", "anonymous"]) {
    assert(f.reset(mode));
    const auth = f.handle("GET", url("/api/auth")).data;
    assert.equal(auth.user === null, mode === "anonymous");
    const home = f.handle("GET", url("/api/consultations"));
    if (mode === "anonymous") assert.equal(home.status, 401);
    else {
      assert.equal(home.data.usage.plan, mode === "plus" ? "plus" : "free");
      assert(Array.isArray(home.data.subjects));
    }
    for (const action of ["checkout", "cancel"])
      assert.equal(
        f.handle("POST", url("/api/billing"), { action }).status,
        403,
      );
  }
  for (const path of [
    "/api/contact",
    "/api/auth",
    "/api/webhooks/stripe",
    "/api/cron/reports",
    "/api/diagnoses/sample-result/checkout",
    "/api/unexpected",
  ])
    assert.equal(f.handle("POST", url(path), {}).status, 403);
  f.reset("free");
  const qs = f.handle("GET", url("/api/questions")).data;
  assert(qs.length >= 8);
  assert.equal(
    f.handle("POST", url("/api/diagnoses"), {}).data.id,
    "sample-draft",
  );
  for (const q of qs) {
    const answer = q.options_json?.[0] || "架空の表示確認です。";
    assert.equal(
      f.handle("POST", url("/api/diagnoses/sample-draft/answers"), {
        key: q.question_key,
        answer,
      }).status,
      200,
    );
  }
  assert.equal(
    f.handle("POST", url("/api/diagnoses/sample-draft/analyze")).data.status,
    "ready",
  );
  const d = f.handle("GET", url("/api/diagnoses/sample-draft")).data;
  assert.equal(d.answers.length, qs.length);
  assert(d.free_report.scores.communication <= 100);
  const paid = f.handle("GET", url("/api/diagnoses/sample-result/report")).data;
  assert(paid.report.messages.natural.includes("補足"));
  assert.equal(
    f.handle("POST", url("/api/consultations/sample-thread/send"), {
      text: "合成相談",
    }).status,
    200,
  );
  assert.equal(
    f.handle("GET", url("/api/consultations?thread=sample-thread")).data.turns
      .length,
    2,
  );
  f.reset("plus");
  assert.equal(
    f.handle("POST", url("/api/billing"), { action: "portal" }).data.url,
    "/__review/portal",
  );
  f.reset("free");
  assert.equal(
    f.handle("POST", url("/api/billing"), { action: "portal" }).status,
    403,
  );
  assert.equal(
    f.handle("GET", url("/api/consultations?thread=sample-thread")).data.turns
      .length,
    1,
  );
  assert.equal(f.reset("anything-else"), false);
});

test("trial input stays local and response explicitly synthetic", () => {
  const f = createFixture(process.cwd());
  const r = f.handle("POST", url("/api/trial/turns"), {
    topicId: "reply",
    text: "合成の入力例",
    fields: {},
  });
  assert.equal(r.data.turn.input.text, "合成の入力例");
  assert(r.data.turn.answer.includes("AI未使用"));
});
