import test from "node:test";
import assert from "node:assert/strict";
import { runtimeDiagnostics } from "./diagnostics.mjs";

test("stop evidence survives without retaining arbitrary paths or secret-bearing fields", () => {
  const saved = [];
  const record = runtimeDiagnostics((name, value) => {
    saved.push({ name, value });
    return { verified: true };
  });
  const secret = "synthetic-sensitive-value";
  record({
    event: "stop",
    code: "WEBHOOK_RESULT_UNKNOWN_OR_FAILED",
    message: secret,
  });
  record({
    event: "policy_denied",
    method: "POST",
    path: "/" + secret,
    headers: { authorization: secret },
  });
  record({
    event: "http",
    method: "POST",
    path: "/api/webhooks/stripe",
    status: 500,
    body: secret,
  });
  record({ event: secret, code: secret });
  assert.equal(saved.length, 3);
  assert.equal(saved[0].value.code, "WEBHOOK_RESULT_UNKNOWN_OR_FAILED");
  assert.equal(saved[1].value.route, "OTHER_ROUTE");
  assert.equal(saved[2].value.status, 500);
  assert(!JSON.stringify(saved).includes(secret));
});
