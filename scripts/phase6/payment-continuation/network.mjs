import http from "node:http";
import { Policy, TARGET, insist, hash } from "../payment-runtime/policy.mjs";
import { bounded, providerTransport } from "../payment-runtime/broker.mjs";
export class ContinuationPolicy extends Policy {
  constructor(m, expected, reserve) {
    super(m, reserve);
    this.payment = expected.payment;
    this.sessionsData = new Map();
    this.rates.delete("checkout:" + m.diagnosis);
  }
  authorize(r) {
    const u = new URL(r.url);
    insist(u.origin === TARGET.supabase, "DESTINATION_DENIED");
    const auth = u.pathname.startsWith("/auth/");
    const rpc = [
      "/rest/v1/rpc/consume_limit",
      "/rest/v1/rpc/claim_anonymous_diagnoses",
    ].includes(u.pathname);
    insist(
      r.method === "GET" || (r.method === "POST" && (auth || rpc)),
      "CONTINUATION_WRITE_DENIED",
    );
    return super.authorize(r);
  }
  accept(t, status, data) {
    super.accept(t, status, data);
    if (t.kind === "login") this.sessionsData.set(t.user, data);
  }
  clear() {
    this.sessionsData.clear();
    this.tokens.clear();
    this.refresh.clear();
    this.stopped = true;
  }
}
export function supabaseTransport(secrets) {
  insist(
    Object.keys(secrets).sort().join(",") === "anon,service",
    "NO_STRIPE_SECRETS",
  );
  const upstream = providerTransport(secrets);
  return (r) => {
    insist(new URL(r.url).origin === TARGET.supabase, "DESTINATION_DENIED");
    return upstream(r);
  };
}
export async function startContinuationBroker({
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
      res.end('{"error":"CONTINUATION_DENIED"}');
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
export function safeRequest(method, path) {
  if (method === "POST") return path === "/api/auth";
  if (!["GET", "HEAD"].includes(method)) return false;
  return (
    path === "/account" ||
    path === "/" ||
    path === "/api/auth" ||
    path === "/api/account" ||
    path === "/api/pricing" ||
    path === "/icon.svg" ||
    path === "/favicon.ico" ||
    /^\/(report|result)\/[a-f0-9-]+$/.test(path) ||
    /^\/api\/diagnoses\/[a-f0-9-]+(\/report)?$/.test(path) ||
    path.startsWith("/_next/static/") ||
    path === "/_next/webpack-hmr" ||
    /^\/payment-test\/start\/[ab]$/.test(path)
  );
}
export { hash };
