import { check } from "./policy.mjs";

const stopCodes = new Set([
  "APP_EXIT",
  "UNAUTHORIZED_PROVIDER_REQUEST",
  "UPSTREAM_OR_RESPONSE_FAILURE",
  "UNEXPECTED_SIGNED_EVENT",
  "WEBHOOK_RESULT_UNKNOWN_OR_FAILED",
]);
const routes = new Set([
  "/account",
  "/plans",
  "/api/auth/login",
  "/api/billing",
  "/api/webhooks/stripe",
  "/subscription-test/c",
  "/subscription-test/d",
  "/rest/v1/rpc/acquire_lock",
  "/rest/v1/rpc/apply_subscription_snapshot",
  "/rest/v1/operation_locks",
]);
// Persist only categorical diagnostics. Never retain errors, bodies, headers,
// arbitrary paths, query strings, auth values or provider response objects.
export function runtimeDiagnostics(save) {
  let sequence = 0;
  return (value) => {
    if (
      ![
        "stop",
        "policy_denied",
        "http",
        "client_error",
        "cookie_scope",
        "finished",
        "startup_failed",
      ].includes(value?.event)
    )
      return;
    const entry = { event: value.event };
    if (value.event === "cookie_scope")
      entry.code = "FOREIGN_COOKIE_OVERFLOW_FILTERED";
    if (value.event === "client_error")
      entry.code =
        value.code === "HEADER_OVERFLOW" ? value.code : "HTTP_PARSE_REJECTED";
    if (value.event === "stop")
      entry.code = stopCodes.has(value.code) ? value.code : "OTHER_STOP";
    if (["policy_denied", "http"].includes(value.event)) {
      entry.method = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(
        value.method,
      )
        ? value.method
        : "OTHER";
      entry.route = routes.has(value.path) ? value.path : "OTHER_ROUTE";
      if (
        Number.isInteger(value.status) &&
        value.status >= 100 &&
        value.status <= 599
      )
        entry.status = value.status;
    }
    if (["finished", "startup_failed"].includes(value.event))
      entry.complete = value.complete === true;
    check(
      save(`runtime-${++sequence}.enc`, entry).verified,
      "DIAGNOSTIC_SAVE_FAILED",
    );
  };
}

export function requestCategory(url, method) {
  const p = new URL(url).pathname;
  const category =
    [
      ["lock_acquire", /^\/rest\/v1\/rpc\/acquire_lock$/],
      ["lock_release", /^\/rest\/v1\/operation_locks$/],
      ["snapshot", /^\/rest\/v1\/rpc\/apply_subscription_snapshot$/],
      ["entitlement", /^\/rest\/v1\/rpc\/consultation_entitlement$/],
      ["subscription", /^\/v1\/subscriptions(?:\/[^/]+)?$/],
      ["invoice", /^\/v1\/invoices$/],
      ["checkout", /^\/v1\/checkout\/sessions(?:\/[^/]+)?$/],
      ["portal", /^\/v1\/billing_portal\//],
      ["auth", /^\/auth\/v1\//],
      ["database", /^\/rest\/v1\//],
    ].find(([, pattern]) => pattern.test(p))?.[0] ?? "other";
  return (
    "application_" +
    (["GET", "POST", "PATCH", "DELETE"].includes(method)
      ? method.toLowerCase()
      : "other") +
    "_" +
    category
  );
}
