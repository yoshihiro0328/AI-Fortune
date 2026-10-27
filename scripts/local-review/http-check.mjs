import assert from "node:assert/strict";
import http from "node:http";
const origin = "http://127.0.0.1:5318";
const check = [];
const get = async (p) => {
  const r = await fetch(origin + p);
  assert.equal(r.status, 200, p);
  return r;
};
const health = await (await get("/__review/health")).json();
assert.equal(health.external, false);
for (const p of [
  "/",
  "/account",
  "/plans",
  "/consult",
  "/diagnosis/partner-mind?new=1",
  "/result/sample-result",
  "/report/sample-result",
  "/chat",
  "/contact",
  "/legal/terms",
]) {
  const r = await get(p),
    html = await r.text();
  assert(html.includes("最新画面のローカル確認"));
  assert(
    r.headers.get("content-security-policy").includes("connect-src 'self'"),
  );
  check.push(p);
}
for (const p of [
  "/api/contact",
  "/api/auth",
  "/api/webhooks/stripe",
  "/api/cron/mail",
  "/api/diagnoses/sample-result/checkout",
  "/api/billing",
]) {
  const r = await fetch(origin + p, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ action: "checkout" }),
  });
  assert.equal(r.status, 403, p);
}
const blocked = await fetch(origin + "/__review/scenario", {
  method: "POST",
  headers: { origin: "https://untrusted.invalid" },
  body: "mode=plus",
});
assert.equal(blocked.status, 403);
const hostStatus = await new Promise((resolve, reject) => {
  const r = http.get(
    origin + "/",
    { headers: { host: "unexpected.invalid" } },
    (res) => {
      res.resume();
      resolve(res.statusCode);
    },
  );
  r.on("error", reject);
});
assert.equal(hostStatus, 403);
const action = await fetch(origin + "/", {
  method: "POST",
  headers: { origin, "next-action": "synthetic" },
  body: "[]",
});
assert.equal(action.status, 403);
const image = await fetch(
  origin + "/_next/image?url=https%3A%2F%2Fexample.invalid%2F&w=100&q=75",
);
assert.equal(image.status, 403);
console.log(
  JSON.stringify({
    passed: true,
    pages: check,
    blockedWrites: 6,
    csrf: true,
    hostValidation: true,
    serverActionsBlocked: true,
    remoteImagesBlocked: true,
    providerRequests: 0,
  }),
);
