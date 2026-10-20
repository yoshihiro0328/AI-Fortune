import { TARGET, EVENTS, check, validate } from "./policy.mjs";
// No network implementation or credentials here. An approved supervisor injects transport.
// All IDs must first be bound to the new run's encrypted manifest; no account-wide search.
export function listenerArgs(run) {
  check(/^[0-9a-f-]{36}$/.test(run));
  return [
    "listen",
    "--project-name",
    "yorisoi-plus-" + run,
    "--events",
    EVENTS.join(","),
    "--events-from",
    "@self",
    "--skip-update",
    "--forward-to",
    TARGET.broker + "/webhook",
  ];
}
export function lifecycle(m, { journal, request, verify }) {
  validate(m);
  const checkouts = new Set(),
    expired = new Set(),
    known = new Set(),
    ended = new Set();
  let frozen, pendingTarget;
  const get = async (path) => {
    const result = await request({
      method: "GET",
      url: TARGET.stripe + path,
      retry: false,
    });
    check(result.status === 200, "LIFECYCLE_READ_FAILED");
    return result.data;
  };
  const mutate = (operation, path, body, method = "POST") =>
    journal.perform(operation, path, async () => {
      const result = await request({
        method,
        url: TARGET.stripe + path,
        body,
        retry: false,
      });
      check(
        result.status >= 200 && result.status < 300,
        "LIFECYCLE_WRITE_FAILED",
      );
      check(
        await verify(operation, result.data),
        "LIFECYCLE_RESPONSE_MISMATCH",
      );
      return result.data;
    });
  return {
    async identify() {
      const account = await get("/v1/account");
      check(account.id === TARGET.account, "ACCOUNT_MISMATCH");
      const customer = await get("/v1/customers/" + m.customer);
      check(
        customer.livemode === false &&
          customer.id === m.customer &&
          customer.test_clock === m.clock &&
          customer.metadata?.run === m.run &&
          customer.metadata?.user_id === m.c.id,
      );
      const clock = await get("/v1/test_helpers/test_clocks/" + m.clock);
      check(
        clock.id === m.clock &&
          clock.livemode === false &&
          clock.status === "ready" &&
          Number.isInteger(clock.frozen_time),
      );
      frozen = clock.frozen_time;
      return { identified: true };
    },
    async bindSubscription(id) {
      check(/^sub_[a-zA-Z0-9_]+$/.test(id));
      const s = await get("/v1/subscriptions/" + id);
      check(
        s.id === id &&
          s.customer === m.customer &&
          s.livemode === false &&
          s.metadata?.user_id === m.c.id &&
          s.items.data.length === 1 &&
          s.items.data[0].price.id === m.price,
      );
      known.add(id);
      check(known.size <= 2);
    },
    async advance(target) {
      check(
        Number.isInteger(frozen) &&
          Number.isInteger(target) &&
          target > frozen &&
          target - frozen <= 32 * 86400,
        "CLOCK_ADVANCE_DENIED",
      );
      const clock = await get("/v1/test_helpers/test_clocks/" + m.clock);
      check(clock.id === m.clock && clock.livemode === false &&
        clock.frozen_time === frozen && clock.status === "ready");
      pendingTarget = target;
      frozen = undefined; // Reserve before the mutation, including an unknown result.
      await mutate(
        "advanceClock",
        "/v1/test_helpers/test_clocks/" + m.clock + "/advance",
        { frozen_time: target },
      );
      // No second advance until a separate bounded read observes ready at this target.
      frozen = undefined;
    },
    async confirmClock(target) {
      check(Number.isInteger(pendingTarget) && target === pendingTarget, "CLOCK_TARGET_MISMATCH");
      const clock = await get("/v1/test_helpers/test_clocks/" + m.clock);
      check(
        clock.id === m.clock &&
          clock.livemode === false &&
          clock.status === "ready" &&
          clock.frozen_time === target,
        "CLOCK_NOT_READY_STOP",
      );
      frozen = target;
      pendingTarget = undefined;
    },
    async bindCheckout(id) {
      check(/^cs_test_[A-Za-z0-9_]+$/.test(id));
      const c = await get("/v1/checkout/sessions/" + id);
      check(
        c.id === id &&
          c.customer === m.customer &&
          c.livemode === false &&
          c.mode === "subscription" &&
          c.metadata?.user_id === m.c.id &&
          c.amount_total === 980 &&
          c.currency === "jpy",
      );
      checkouts.add(id);
      check(checkouts.size <= 2);
    },
    async expire(id) {
      check(checkouts.has(id) && !expired.has(id));
      const c = await get("/v1/checkout/sessions/" + id);
      check(c.customer === m.customer && c.livemode === false);
      if (c.status === "complete" || c.status === "expired")
        return { unchanged: true };
      check(c.status === "open");
      expired.add(id);
      return mutate(
        "expireCheckout",
        "/v1/checkout/sessions/" + id + "/expire",
        {},
      );
    },
    async end(id, cleanup = false) {
      check(known.has(id) && !ended.has(id));
      ended.add(id); // Reserve before sending; never retry an unknown cancellation.
      return mutate(
        cleanup ? "cleanupCancel" : "cancelImmediate",
        "/v1/subscriptions/" + id,
        { invoice_now: false, prorate: false },
        "DELETE",
      );
    },
    async observe(id) {
      check(known.has(id));
      return get("/v1/subscriptions/" + id);
    },
  };
}
