import http from "node:http";
import {
  ContinuationPolicy,
  supabaseTransport,
} from "../payment-continuation/network.mjs";
import { TARGET, insist } from "../payment-runtime/policy.mjs";
import { bounded } from "../payment-runtime/broker.mjs";
export { supabaseTransport };
export class VerificationPolicy extends ContinuationPolicy {
  authorize(r) {
    const u = new URL(r.url),
      h = new Headers(r.headers),
      q = Object.fromEntries(u.searchParams);
    if (
      r.method === "GET" &&
      u.origin === TARGET.supabase &&
      u.pathname === "/rest/v1/diagnoses" &&
      q.user_id === "is.null"
    ) {
      insist(
        this.ready &&
          !this.stopped &&
          h.get("apikey") === "local-service" &&
          h.get("authorization") === "Bearer local-service",
      );
      insist(
        ["accept-profile", "content-profile"].every(
          (k) => !h.has(k) || h.get(k) === "public",
        ) &&
          !u.hash &&
          !u.username &&
          !u.password,
      );
      insist(
        Object.keys(q).length === 6 &&
          [...u.searchParams].length === 6 &&
          q.select === "id,status,created_at" &&
          q.order === "created_at.desc" &&
          q.offset === "0" &&
          q.limit === "20" &&
          Object.values(this.sessions).some(
            (s) => q.anonymous_session_id === "eq." + s,
          ),
      );
      return { kind: "anonymous_list" };
    }
    return super.authorize(r);
  }
  accept(t, status, data) {
    if (t.kind === "anonymous_list") {
      insist(
        status === 200 && Array.isArray(data) && data.length === 0,
        "ANONYMOUS_LIST_UNEXPECTED",
      );
      return;
    }
    super.accept(t, status, data);
  }
}
export function routeName(method, url, id) {
  const u = new URL(url, TARGET.app),
    p = u.pathname;
  if (method === "POST") return p === "/api/auth" ? "auth" : null;
  if (!["GET", "HEAD"].includes(method)) return null;
  if (p === "/api/diagnoses")
    return u.searchParams.get("offset") === "0" &&
      [...u.searchParams].length === 1
      ? "diagnosis_list"
      : null;
  if (p === `/api/diagnoses/${id}/report`) return "report_api";
  if (p === `/report/${id}`) return "report_page";
  if (p === "/account") return "account_page";
  if (p === "/api/auth") return "auth";
  if (p === "/payment-test/start/a" || p === "/payment-test/start/b")
    return "start_" + p.at(-1);
  if (
    ["/favicon.ico", "/icon.svg", "/__nextjs_font/geist-latin.woff2"].includes(
      p,
    ) ||
    p.startsWith("/_next/static/") ||
    p === "/_next/webpack-hmr"
  )
    return "asset";
  return null;
}
export async function startBroker({
  policy,
  transport,
  token,
  onStop,
  record,
  port = 5209,
}) {
  let chain = Promise.resolve(),
    stopped = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      insist(
        !stopped &&
          req.url === "/proxy" &&
          req.method === "POST" &&
          req.headers["x-payment-token"] === token,
      );
      const r = JSON.parse(await bounded(req));
      const task = chain.then(async () => {
        let t;
        try {
          t = policy.authorize(r);
        } catch {
          policy.stopped = true;
          record("denied_provider", {
            method: ["GET", "POST", "PATCH", "DELETE"].includes(r.method)
              ? r.method
              : "other",
          });
          onStop("unauthorized_provider_request");
          throw Error("DENIED");
        }
        try {
          const out = await transport(r),
            data = JSON.parse(out.text);
          policy.accept(t, out.status, data);
          record("provider_response", {
            operation: t.kind,
            httpStatus: out.status,
          });
          return out;
        } catch {
          policy.stopped = true;
          record("provider_failed", { operation: t.kind });
          onStop("provider_failed_or_unknown");
          throw Error("STOP");
        }
      });
      chain = task.catch(() => {});
      const out = await task;
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(out.text);
    } catch {
      res.writeHead(403, { "content-type": "application/json" });
      res.end('{"error":"VERIFICATION_DENIED"}');
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    async stop() {
      stopped = true;
      policy.stopped = true;
      await Promise.race([
        chain,
        new Promise((r) => setTimeout(r, 16000).unref()),
      ]);
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
export function ratesUnchangedExcept(before, after, policy) {
  const allowed = new Set(
    [...policy.rates.keys()].filter(
      (k) => k.startsWith("auth:") || k.startsWith("auth-email:"),
    ),
  );
  const old = new Map(before.map((x) => [x.key, x]));
  let changed = 0,
    added = 0;
  for (const row of after) {
    const prior = old.get(row.key);
    if (JSON.stringify(prior) !== JSON.stringify(row)) {
      insist(allowed.has(row.key), "UNEXPECTED_RATE_CHANGE");
      if (prior) changed++;
      else added++;
    }
    old.delete(row.key);
  }
  insist(old.size === 0, "RATE_ROW_REMOVED");
  return {
    before: before.length,
    after: after.length,
    changed,
    added,
    removed: 0,
    allowedKeysMatched: true,
  };
}
