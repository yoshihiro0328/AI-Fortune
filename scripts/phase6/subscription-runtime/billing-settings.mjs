import { check, TARGET } from "./policy.mjs";
const equal = (a, b) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(b).every((key) => a[key] === b[key]);
export const ORIGINAL_BILLING = Object.freeze({
  cardRetries: true,
  retryMode: "smart",
  retryWeeks: 2,
  retryCount: 8,
  exhausted: "cancel",
  firstFailure: "past_due",
  invoiceFailure: "open",
  graceHours: 1,
});
export const TRIAL_BILLING = Object.freeze({
  ...ORIGINAL_BILLING,
  cardRetries: false,
  exhausted: "past_due",
});

// read/write are Work's bounded operator bridge, never a credential-screen scraper.
// Writes are reserved before dispatch. Unknown results permit reads, never resends.
export function billingSettings({ read, write, save }) {
  let baseline,
    started = false,
    seq = 0;
  const reserved = new Set();
  const persist = (value) =>
    check(save(`billing-${++seq}.enc`, value).verified);
  const observe = async (signal) => {
    check(!signal?.aborted, "SETTINGS_ABORTED");
    const value = await read(signal);
    check(!signal?.aborted, "SETTINGS_ABORTED");
    check(value.account === TARGET.account && value.livemode === false);
    check(["api", "work-ui", "owner-ui"].includes(value.source));
    check(
      Number.isSafeInteger(value.observedAt) &&
        Math.abs(Date.now() - value.observedAt) < 60000,
      "STALE_SETTINGS_EVIDENCE",
    );
    check(
      value.settings &&
        Object.keys(value.settings).sort().join(",") ===
          Object.keys(ORIGINAL_BILLING).sort().join(",") &&
        Object.keys(ORIGINAL_BILLING).every(
          (key) => typeof value.settings[key] === typeof ORIGINAL_BILLING[key],
        ),
    );
    persist({
      account: value.account,
      livemode: value.livemode,
      source: value.source,
      observedAt: value.observedAt,
      settings: value.settings,
    });
    return value;
  };
  const mutate = async (field, value, phase, signal) => {
    check(!signal?.aborted, "SETTINGS_ABORTED");
    const key = `${phase}:${field}`;
    check(!reserved.has(key), "SETTINGS_ALREADY_RESERVED");
    reserved.add(key);
    persist({ phase, field, value, state: "reserved" });
    await write({ account: TARGET.account, field, value, phase }, signal);
    const result = await observe(signal);
    check(result.settings[field] === value, "SETTING_RESULT_UNKNOWN");
    return result;
  };
  return {
    async prepare(signal) {
      check(!started, "SETTINGS_ALREADY_STARTED");
      started = true;
      const before = await observe(signal);
      check(
        equal(before.settings, ORIGINAL_BILLING),
        "SETTINGS_BASELINE_MISMATCH",
      );
      check(
        before.unrelatedContracts === 0 &&
          before.uncollectedInvoices === 0 &&
          before.automationsActive === false,
        "BILLING_IMPACT_UNCONFIRMED",
      );
      baseline = before.settings;
      await mutate("cardRetries", false, "prepare", signal);
      const after = await mutate("exhausted", "past_due", "prepare", signal);
      check(equal(after.settings, TRIAL_BILLING), "SETTINGS_UNEXPECTED_CHANGE");
      return true;
    },
    async restore(safe) {
      const results = {};
      // A failure restoring one field must not skip the other independent field.
      for (const field of ["cardRetries", "exhausted"]) {
        try {
          const observed = await observe();
          const original = (baseline ?? ORIGINAL_BILLING)[field];
          if (observed.settings[field] !== original) {
            check(baseline && safe === true, "INVOICES_NOT_SAFE_FOR_RESTORE");
            await mutate(field, original, "restore");
          }
          results[field] = "verified";
        } catch {
          results[field] = "failed_or_unknown";
        }
      }
      try {
        check(equal((await observe()).settings, ORIGINAL_BILLING));
        results.readback = "verified";
      } catch {
        results.readback = "failed_or_unknown";
      }
      persist({ restoration: results });
      return {
        ...results,
        complete: Object.values(results).every((x) => x === "verified"),
      };
    },
  };
}
