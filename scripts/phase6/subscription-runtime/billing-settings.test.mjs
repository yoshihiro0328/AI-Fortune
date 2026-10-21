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

for (const mode of [
  "disabled-display",
  "unlabelled-drift",
  "active-drift",
  "wrong-flag",
  "other-change",
]) {
  test(
    "retry display applicability and exact restoration: " + mode,
    async () => {
      let settings = { ...ORIGINAL_BILLING };
      const writes = [],
        saved = [];
      const billing = billingSettings({
        read: async () => {
          const disabled = !settings.cardRetries;
          return {
            account: TARGET.account,
            livemode: false,
            source: "work-ui",
            observedAt: Date.now(),
            settings: {
              ...settings,
              ...(disabled ? { retryWeeks: 4, retryCount: 4 } : {}),
            },
            retryControlsDisabled:
              mode === "wrong-flag" ||
              (disabled && mode !== "unlabelled-drift"),
            unrelatedContracts: 0,
            uncollectedInvoices: 0,
            automationsActive: false,
          };
        },
        write: async (value) => {
          writes.push(value);
          settings[value.field] = value.value;
          if (value.retryPolicy) Object.assign(settings, value.retryPolicy);
          if (mode === "other-change" && value.phase === "prepare")
            settings.graceHours = 2;
          if (mode === "active-drift" && value.phase === "restore")
            settings.retryCount = 4;
        },
        save: (name, data) => {
          saved.push({ name, data });
          return { verified: true };
        },
      });
      if (["unlabelled-drift", "wrong-flag", "other-change"].includes(mode)) {
        await assert.rejects(billing.prepare());
        assert.equal(writes.filter((x) => x.field === "exhausted").length, 0);
        return;
      }
      await billing.prepare();
      assert(
        saved.some(
          (x) =>
            x.data.retryPolicyPersistence === "unverified" &&
            x.data.settings.retryCount === 4,
        ),
      );
      const restored = await billing.restore(true);
      assert.equal(restored.complete, mode === "disabled-display");
      assert.deepEqual(
        writes.find((x) => x.phase === "restore" && x.field === "cardRetries")
          .retryPolicy,
        { retryMode: "smart", retryWeeks: 2, retryCount: 8 },
      );
      if (mode === "disabled-display")
        assert.deepEqual(settings, ORIGINAL_BILLING);
    },
  );
}
