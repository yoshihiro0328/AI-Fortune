import test from "node:test";
import assert from "node:assert/strict";
import { runtimeDiagnostics, requestCategory } from "./diagnostics.mjs";

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
test("request categories identify synchronization phases without identifiers or query values", () => {
  assert.equal(
    requestCategory(
      "https://api.stripe.com/v1/subscriptions/sub_sensitive?secret=sensitive",
      "GET",
    ),
    "application_get_subscription",
  );
  assert.equal(
    requestCategory(
      "https://db.invalid/rest/v1/rpc/apply_subscription_snapshot",
      "POST",
    ),
    "application_post_snapshot",
  );
  assert.equal(
    requestCategory("https://db.invalid/rest/v1/rpc/acquire_lock", "POST"),
    "application_post_lock_acquire",
  );
});
