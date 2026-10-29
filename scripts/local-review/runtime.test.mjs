import test from "node:test";
import assert from "node:assert/strict";
import { environment, profile } from "./runtime.mjs";
test("review environment never inherits credentials, heap overrides, development mode or live flags", () => {
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic-only";
  try {
    const env = environment("/private/tmp/synthetic-review");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.STRIPE_LIVE_CHECKOUT_ENABLED, "false");
    assert.equal(env.AUTH_EMAIL_MODE, "disabled");
    assert.equal(env.LOCAL_REVIEW_ISOLATED, "true");
    assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");
  } finally {
    if (before === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = before;
  }
  assert(profile.includes("(deny network-outbound)"));
  assert(profile.includes("localhost:*"));
});
