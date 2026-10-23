import { TARGET, check } from "./policy.mjs";
import { minimalRequest } from "./minimal-profile.mjs";
import { API_VERSION } from "./listener.mjs";
// The same HTTP encoder/reader is used for providers and loopback tests. No redirects,
// retries, global environment credentials, arbitrary headers, or URL credentials.
const errors = new Set([
  "weak_password",
  "over_request_rate_limit",
  "invalid_credentials",
  "permission_missing",
  "api_key_expired",
  "api_key_invalid",
  "invalid_api_key",
  "42501",
  "42703",
  "PGRST116",
]);
function form(value, prefix = "", out = new URLSearchParams()) {
  for (const [key, v] of Object.entries(value)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (v && typeof v === "object") form(v, name, out);
    else if (v !== undefined && v !== null) out.append(name, String(v));
  }
  return out;
}
function build({
  secrets,
  record = () => {},
  trace = () => {},
  endpoints,
  timeoutMs = 15000,
  minimal = false,
  passwordResetUsers = [],
}) {
  check(timeoutMs > 0 && timeoutMs <= 15000);
  check(
    Array.isArray(passwordResetUsers) &&
      passwordResetUsers.length <= 2 &&
      new Set(passwordResetUsers).size === passwordResetUsers.length &&
      passwordResetUsers.every((id) => /^[a-f0-9-]{36}$/.test(id)),
    "PASSWORD_RESET_SCOPE_DENIED",
  );
  const send = async ({
    provider,
    role,
    method = "GET",
    path,
    body,
    operation,
    signal,
    idempotencyKey,
    bearer,
    accept = "application/json",
  }) => {
    if (minimal) minimalRequest({ provider, method, path, body });
    check(["stripe", "supabase"].includes(provider));
    check(/^[a-z][a-z0-9_]{0,63}$/.test(operation), "OPERATION_NAME_REQUIRED");
    check(["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method));
    if (method === "PUT")
      check(
        provider === "supabase" &&
          role === "service" &&
          operation === "reset_retained_password" &&
          passwordResetUsers.includes(path.split("/").at(-1)) &&
          /^\/auth\/v1\/admin\/users\/[a-f0-9-]{36}$/.test(path) &&
          body &&
          Object.keys(body).join(",") === "password" &&
          typeof body.password === "string" &&
          body.password.length >= 12,
        "PASSWORD_RESET_SCOPE_DENIED",
      );
    check(path.startsWith(provider === "stripe" ? "/v1/" : "/"));
    const origin = endpoints[provider],
      url = new URL(path, origin);
    check(
      url.origin === origin && !url.username && !url.password && !url.hash,
      "DESTINATION_DENIED",
    );
    if (provider === "supabase")
      check(/^\/(rest|auth)\/v1\//.test(url.pathname));
    check(
      ["application/json", "application/vnd.pgrst.object+json"].includes(
        accept,
      ),
      "ACCEPT_HEADER_DENIED",
    );
    const headers = new Headers({ accept });
    if (provider === "stripe") {
      check(["app", "listener", "lifecycle"].includes(role));
      check(
        /^rk_test_[A-Za-z0-9]+$/.test(secrets[role]),
        "RESTRICTED_KEY_REQUIRED",
      );
      headers.set("authorization", "Bearer " + secrets[role]);
      headers.set("stripe-version", API_VERSION);
      headers.set("content-type", "application/x-www-form-urlencoded");
      if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    } else {
      check(["service", "anon", "user"].includes(role));
      const key = role === "service" ? secrets.service : secrets.anon;
      check(typeof key === "string" && key.length > 0);
      check(
        role !== "user" || (typeof bearer === "string" && bearer.length > 0),
      );
      headers.set("apikey", key);
      headers.set(
        "authorization",
        "Bearer " + (role === "user" ? bearer : key),
      );
      headers.set("content-type", "application/json");
      headers.set("prefer", "return=representation");
    }
    let status = null;
    trace({ phase: "sent", operation });
    try {
      const r = await fetch(url, {
        method,
        headers,
        redirect: "error",
        body:
          body === undefined
            ? undefined
            : typeof body === "string"
              ? body
              : provider === "stripe"
                ? form(body)
                : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
      status = r.status;
      const chunks = [];
      let bytes = 0;
      for await (const chunk of r.body ?? []) {
        bytes += chunk.length;
        if (bytes > 1000000) throw Error("BODY_LIMIT");
        chunks.push(chunk);
      }
      let data;
      try {
        // This scoped RPC returns PostgreSQL void: PostgREST sends 204 with
        // no body after committing it. Do not replay a successful mutation
        // because there is no JSON to parse. Other missing bodies still fail.
        if (
          status === 204 &&
          bytes === 0 &&
          provider === "supabase" &&
          method === "POST" &&
          url.pathname === "/rest/v1/rpc/apply_subscription_snapshot"
        )
          data = undefined;
        else data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw Error("INVALID_JSON");
      }
      if (!r.ok) {
        const code = data?.error?.code ?? data?.code;
        throw Error(errors.has(code) ? code : "HTTP_FAILED");
      }
      record({ operation, httpStatus: status, code: null });
      trace({ phase: "received", operation });
      return data;
    } catch (error) {
      const code =
        errors.has(error.message) ||
        ["HTTP_FAILED", "BODY_LIMIT", "INVALID_JSON"].includes(error.message)
          ? error.message
          : ["TimeoutError", "AbortError"].includes(error.name)
            ? "TIMEOUT_OR_ABORT"
            : "TRANSPORT_FAILED";
      record({ operation, httpStatus: status, code });
      trace({ phase: "failed", operation });
      throw Object.assign(Error(code), { httpStatus: status });
    }
  };
  const pending = new Set();
  const request = (args) => {
    const p = send(args);
    pending.add(p);
    p.then(
      () => pending.delete(p),
      () => pending.delete(p),
    );
    return p;
  };
  request.settle = () => Promise.allSettled([...pending]);
  return request;
}
export function providerWire(options) {
  return build({
    ...options,
    endpoints: { stripe: TARGET.stripe, supabase: TARGET.supabase },
  });
}
// Explicit programmatic test-only factory. Real credentials cannot be routed to mocks.
export function mockWire({ origin, ...options }) {
  const u = new URL(origin);
  check(
    u.protocol === "http:" && u.hostname === "127.0.0.1" && u.origin === origin,
    "MOCK_LOOPBACK_ONLY",
  );
  check(
    Object.values(options.secrets).every((v) =>
      /^(rk_test_)?synthetic[A-Za-z]*$/.test(v),
    ),
    "MOCK_SYNTHETIC_ONLY",
  );
  return build({ ...options, endpoints: { stripe: origin, supabase: origin } });
}
