import { test } from "node:test";
import assert from "node:assert/strict";
import { billingSettings, ORIGINAL_BILLING } from "./billing-settings.mjs";
import { TARGET } from "./policy.mjs";
for (const mode of [
  "normal",
  "unknown-prepare",
  "restore-failed",
  "unsafe",
  "impact",
  "stale",
]) {
  test("billing restore independent and fail closed: " + mode, async () => {
    let settings = { ...ORIGINAL_BILLING };
    const writes = [],
      saved = [];
    const billing = billingSettings({
      read: async () => ({
        account: TARGET.account,
        livemode: false,
        source: "api",
        observedAt: Date.now() - (mode === "stale" ? 120000 : 0),
        settings: { ...settings },
        unrelatedContracts: mode === "impact" ? 1 : 0,
        uncollectedInvoices: 0,
        automationsActive: false,
      }),
      write: async (value) => {
        writes.push(value);
        if (
          mode === "restore-failed" &&
          value.phase === "restore" &&
          value.field === "cardRetries"
        )
          throw Error("synthetic");
        settings[value.field] = value.value;
        if (mode === "unknown-prepare" && value.phase === "prepare")
          throw Error("synthetic");
      },
      save: (name, data) => {
        saved.push({ name, data });
        return { verified: true };
      },
    });
    if (["impact", "stale", "unknown-prepare"].includes(mode))
      await assert.rejects(billing.prepare());
    else await billing.prepare();
    const result = await billing.restore(mode !== "unsafe");
    assert.equal(
      result.complete,
      !["unsafe", "restore-failed", "stale"].includes(mode),
    );
    if (mode === "restore-failed") {
      assert.equal(settings.exhausted, "cancel");
      assert.equal(result.cardRetries, "failed_or_unknown");
    }
    if (mode === "impact") assert.equal(writes.length, 0);
    if (mode === "unsafe")
      assert.equal(writes.filter((x) => x.phase === "restore").length, 0);
    await assert.rejects(billing.prepare());
    const previous = writes.length;
    await billing.restore(true);
    if (mode === "restore-failed") assert.equal(writes.length, previous);
    assert(saved.length);
  });
}
