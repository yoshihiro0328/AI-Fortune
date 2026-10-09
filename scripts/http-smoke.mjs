import assert from "node:assert/strict";
const base = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
async function call(path, method = "GET", body, cookie, origin = base) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "POST"
        ? { "Content-Type": "application/json", origin }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, data: await response.json() };
}
const foreign = await call(
  "/api/diagnoses",
  "POST",
  {},
  undefined,
  "https://hostile.invalid",
);
assert.equal(foreign.response.status, 403);
const created = await call("/api/diagnoses", "POST", {});
assert.equal(created.response.status, 200, JSON.stringify(created.data));
const cookie = created.response.headers
  .getSetCookie()
  .find((x) => x.startsWith("yorisoi_session="))
  ?.split(";")[0];
assert.ok(cookie);
const id = created.data.id;
const questions = await call("/api/questions");
assert.equal(questions.data.length, 10);
const save = await call(
  `/api/diagnoses/${id}/answers`,
  "POST",
  { key: "relationship", answer: "友人" },
  cookie,
);
assert.equal(save.response.status, 200);
const resumed = await call(`/api/diagnoses/${id}`, "GET", undefined, cookie);
assert.equal(resumed.data.answers[0].answer_text, "友人");
const stranger = await call("/api/diagnoses", "POST", {});
const strangerCookie = stranger.response.headers
  .getSetCookie()
  .find((x) => x.startsWith("yorisoi_session="))
  ?.split(";")[0];
assert.equal(
  (await call(`/api/diagnoses/${id}`, "GET", undefined, strangerCookie))
    .response.status,
  404,
);
assert.equal((await call(`/api/diagnoses/${id}`)).response.status, 401);
assert.equal(
  (await call(`/api/diagnoses/${id}/report`, "GET", undefined, cookie)).response
    .status,
  403,
);
assert.equal(
  (await call(`/api/diagnoses/${id}/report`, "POST", {}, cookie)).response
    .status,
  403,
);
assert.equal(
  (await call(`/api/diagnoses/${id}/checkout`, "POST", {}, cookie)).response
    .status,
  409,
);
assert.equal(
  (
    await call("/api/webhooks/stripe", "POST", {
      type: "checkout.session.completed",
    })
  ).response.status,
  400,
);
console.log(
  "HTTP smoke: CSRF, anonymous create/save/resume, IDOR, unpaid report read/generate, premature checkout, forged webhook — PASS.",
);
console.log("Synthetic diagnosis IDs:", id, stranger.data.id);
