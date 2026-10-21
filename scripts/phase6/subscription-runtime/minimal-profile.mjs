import { check } from "./policy.mjs";
export const MINIMAL = "minimal-plus-v1";
export const minimal = (m) => m.scenario === MINIMAL;
export const MINIMAL_LIMITS = Object.freeze({
  createUsers: 2,
  createClock: 0,
  createCustomer: 1,
  createPortalConfiguration: 1,
  bindCustomer: 1,
  bindPortal: 1,
  activatePrice: 1,
  checkout: 1,
  pay: 1,
  portal: 1,
  advanceClock: 0,
  attachFailureMethod: 0,
  setFailingMethod: 0,
  setGoodMethod: 0,
  cancelImmediate: 1,
  cleanupCancel: 1,
  expireCheckout: 1,
  cancelPeriodEnd: 0,
  duplicate: 0,
  outOfOrder: 0,
  compatibilityPortal: 0,
});
// Defense at the real sender, in addition to scoped IDs / counters in the driver.
export function minimalRequest(r) {
  if (r.provider !== "stripe") return;
  const p = new URL(r.path, "https://api.stripe.com").pathname;
  const method = r.method ?? "GET";
  check(
    !p.includes("test_clocks") &&
      !p.includes("payment_methods") &&
      !p.startsWith("/v1/events"),
    "MINIMAL_OPERATION_DENIED",
  );
  if (method === "GET") return;
  const allowed =
    method === "POST" &&
    (p === "/v1/customers" ||
      p === "/v1/checkout/sessions" ||
      /^\/v1\/checkout\/sessions\/cs_test_[\w]+\/expire$/.test(p) ||
      p === "/v1/billing_portal/sessions" ||
      p === "/v1/billing_portal/configurations" ||
      /^\/v1\/billing_portal\/configurations\/bpc_[\w]+$/.test(p));
  check(
    allowed ||
      (method === "DELETE" && /^\/v1\/subscriptions\/sub_[\w]+$/.test(p)),
    "MINIMAL_OPERATION_DENIED",
  );
  if (method === "DELETE")
    check(
      r.body?.invoice_now === false && r.body?.prorate === false,
      "CANCEL_CHARGES_DENIED",
    );
}
