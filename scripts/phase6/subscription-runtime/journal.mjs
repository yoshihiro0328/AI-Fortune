import fs from "node:fs";
import { check, sha, TARGET, validate } from "./policy.mjs";
// A new attempt journal never replaces an old attempt, and reservations precede side effects.
export const LIMITS = Object.freeze({
  createUsers: 2,
  createClock: 1,
  createCustomer: 1,
  createPortalConfiguration: 1,
  bindCustomer: 1,
  activatePrice: 1,
  checkout: 2,
  pay: 2,
  portal: 2,
  advanceClock: 3,
  setFailingMethod: 1,
  setGoodMethod: 1,
  cancelImmediate: 1,
  cleanupCancel: 2,
  expireCheckout: 2,
  cancelPeriodEnd: 2,
  duplicate: 1,
  outOfOrder: 1,
});
export function journal(file, attemptId, previousAttemptId) {
  check(attemptId !== previousAttemptId && /^[0-9a-f-]{36}$/.test(attemptId));
  const fd = fs.openSync(file, "wx", 0o600),
    counts = new Map();
  let stopped = false;
  const write = (x) => {
    fs.writeSync(fd, JSON.stringify(x) + "\n");
    fs.fsyncSync(fd);
  };
  write({
    event: "attempt",
    attemptId,
    previousAttemptId: previousAttemptId ?? null,
    project: TARGET.ref,
    account: TARGET.account,
  });
  return {
    async perform(operation, scope, fn) {
      check(!stopped && LIMITS[operation], "STOPPED_OR_UNKNOWN_OPERATION");
      const n = (counts.get(operation) || 0) + 1;
      check(n <= LIMITS[operation], "OPERATION_LIMIT");
      counts.set(operation, n);
      write({ event: "reserved", operation, number: n, scopeHash: sha(scope) });
      try {
        const result = await fn();
        write({ event: "returned", operation, number: n });
        return result;
      } catch {
        stopped = true;
        write({ event: "unknown_or_failed", operation, number: n });
        throw Error("RESULT_UNKNOWN_STOP");
      }
    },
    stop() {
      stopped = true;
    },
    close() {
      fs.closeSync(fd);
    },
  };
}
export async function observePreflight(m, read) {
  validate(m);
  const paths = {
    environment: "payment_environment?select=*",
    prices: "price_versions?select=*",
    settings: "service_settings?select=*",
  };
  const actual = {};
  for (const [name, p] of Object.entries(paths)) actual[name] = await read(p);
  check(
    actual.environment.length === 1 &&
      actual.environment[0].stripe_account_id === TARGET.account &&
      actual.environment[0].mode === "sandbox",
  );
  const price = actual.prices.filter((x) => x.id === m.version);
  check(
    price.length === 1 &&
      price[0].kind === "plus" &&
      price[0].amount === 980 &&
      price[0].is_test &&
      price[0].active === true &&
      price[0].stripe_price_id === m.price &&
      price[0].stripe_product_id === m.product,
  );
  check(
    actual.prices.filter((x) => x.id !== m.version).every((x) => !x.active),
  );
  check(
    actual.settings.length === 1 &&
      actual.settings[0].portal_configuration_id === m.portal &&
      actual.settings[0].free_limit === 3 &&
      actual.settings[0].plus_limit === 30,
  );
  for (const u of [m.c, m.d])
    for (const t of [
      "profiles",
      "diagnoses",
      "payments",
      "subscriptions",
      "subscription_invoices",
    ])
      actual[t + ":" + u.id] = await read(t + "?select=*&user_id=eq." + u.id);
  // Minimal runs provision Auth users only. The application's first login creates
  // each profile through claim_anonymous_diagnoses; verify it after login instead.
  const profileCount =
    m.scenario === "minimal-plus-v1" && !m.preAuthenticated ? 0 : 1;
  check(
    actual["profiles:" + m.c.id].length === profileCount &&
      actual["profiles:" + m.d.id].length === profileCount,
    "PRELOGIN_PROFILE_STATE_MISMATCH",
  );
  for (const [k, rows] of Object.entries(actual))
    if (/^(diagnoses|payments|subscriptions|subscription_invoices):/.test(k))
      check(rows.length === 0, "DEDICATED_USER_NOT_EMPTY");
  const binding = await read("billing_customers?select=*&user_id=eq." + m.c.id);
  check(
    binding.length === 1 &&
      binding[0].stripe_customer_id === m.customer &&
      binding[0].is_test &&
      binding[0].checkout_session_id === (m.resume?.history?.checkout ?? null),
  );
  actual.binding = binding;
  actual.bindingD = await read(
    "billing_customers?select=*&user_id=eq." + m.d.id,
  );
  check(actual.bindingD.length === 0, "NONBUYER_CUSTOMER_EXISTS");
  check(
    m.retained &&
      Object.keys(m.retained).sort().join(",") ===
        "diagnoses,diagnosis_answers,free_reports,paid_reports,payments",
    "RETAINED_MANIFEST_REQUIRED",
  );
  for (const [table, id] of Object.entries(m.retained)) {
    check(/^[0-9a-f-]{36}$/.test(id));
    actual["retained:" + table] = await read(table + "?select=*&id=eq." + id);
    check(actual["retained:" + table].length === 1, "RETAINED_ROW_MISSING");
  }
  return actual;
}
export async function preflight(m, read, expected) {
  const actual = await observePreflight(m, read);
  // Caller supplies the previous encrypted observation; never silently adopts current data.
  check(expected && sha(actual) === sha(expected), "BASELINE_MISMATCH");
  return actual;
}
