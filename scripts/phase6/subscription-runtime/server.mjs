import http from "node:http";
import next from "next";
import { TARGET, check } from "./policy.mjs";
import { browserCookies } from "./browser-cookies.mjs";
check(
  process.send && process.env.SUBSCRIPTION_INTEGRATION_LOCAL === "true",
  "SUPERVISOR_REQUIRED",
);
const app = next({
  dev: true,
  webpack: true,
  hostname: "localhost",
  port: 5218,
});
const scopedCookies = browserCookies(
  process.env.SUBSCRIPTION_BROWSER_COOKIE_NAMESPACE,
);
let server;
const pending = new Map();
async function close() {
  server?.closeAllConnections();
  await app.close();
  process.exit(0);
}
process.on("disconnect", close);
process.on("SIGTERM", close);
process.on("SIGINT", close);
process.on("message", (m) => {
  if (m === "stop") void close();
  if (m?.paid) {
    const res = pending.get(m.paid);
    pending.delete(m.paid);
    if (res) {
      res.writeHead(303, { Location: "/account?subscription=complete" });
      res.end();
    }
  }
  if (m?.portalCanceled) {
    const res = pending.get("portal");
    pending.delete("portal");
    if (res) {
      res.writeHead(303, { Location: "/account" });
      res.end();
    }
  }
});
await app.prepare();
const handle = app.getRequestHandler();
server = http.createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!["localhost:5218", "127.0.0.1:5218"].includes(req.headers.host)) {
    res.writeHead(403);
    return res.end();
  }
  const u = new URL(req.url, TARGET.app);
  if (
    process.env.SUBSCRIPTION_AUTH_ONLY === "true" &&
    ["/api/billing", "/api/webhooks/stripe"].includes(u.pathname)
  ) {
    res.writeHead(403);
    return res.end();
  }
  res.once("finish", () =>
    process.send?.({
      http: { method: req.method, path: u.pathname, status: res.statusCode },
    }),
  );
  let browserState;
  try {
    browserState = scopedCookies.install(req, res);
  } catch {
    res.writeHead(403);
    return res.end();
  }
  if (
    ["/subscription-test/c", "/subscription-test/d"].includes(u.pathname) &&
    req.method === "GET"
  ) {
    process.send?.({
      http: {
        method: req.method,
        path: u.pathname,
        checkpoint: "entry-cookie-scope",
        foreignAuthIgnored: browserState.foreignAuth,
        currentAuthRejected: browserState.authenticated,
      },
    });
    if (browserState.authenticated) {
      res.writeHead(403);
      return res.end();
    }
    res.setHeader(
      "Set-Cookie",
      `yorisoi_session=${process.env[u.pathname.endsWith("/c") ? "SUBSCRIPTION_COOKIE_C" : "SUBSCRIPTION_COOKIE_D"]}; HttpOnly; SameSite=Lax; Path=/`,
    );
    res.writeHead(303, { Location: "/account" });
    return res.end();
  }
  if (u.pathname.startsWith("/__subscription/")) {
    if (process.env.SUBSCRIPTION_SYNTHETIC !== "true") {
      res.writeHead(403);
      return res.end();
    }
    if (
      req.method === "GET" &&
      /^\/__subscription\/checkout\/[12]$/.test(u.pathname)
    ) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(
        '<h1>ローカル代替 Checkout：980 JPY／月</h1><form method="post" action="/__subscription/pay/' +
          u.pathname.split("/").at(-1) +
          '"><button>合成テスト支払い</button></form>',
      );
    }
    if (
      req.method === "POST" &&
      /^\/__subscription\/pay\/[12]$/.test(u.pathname) &&
      req.headers.origin === TARGET.app
    ) {
      const n = Number(u.pathname.split("/").at(-1));
      if (pending.has(n)) {
        res.writeHead(409);
        return res.end();
      }
      pending.set(n, res);
      process.send({ pay: n });
      return;
    }
    if (req.method === "GET" && u.pathname === "/__subscription/portal") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(
        "<h1>ローカル代替 Customer Portal</h1>" +
          (u.searchParams.get("session") === "2"
            ? '<form method="post" action="/__subscription/portal-cancel"><button>期間末で解約する（ローカル代替）</button></form>'
            : "") +
          '<a href="/account">よりそいへ戻る</a>',
      );
    }
    if (
      req.method === "POST" &&
      u.pathname === "/__subscription/portal-cancel" &&
      req.headers.origin === TARGET.app &&
      !pending.has("portal")
    ) {
      pending.set("portal", res);
      process.send({ portalCancel: true });
      return;
    }
    res.writeHead(403);
    return res.end();
  }
  if (
    u.pathname === "/api/webhooks/stripe" &&
    req.headers["x-payment-forward"] !== process.env.SUBSCRIPTION_FORWARD_TOKEN
  ) {
    res.writeHead(403);
    return res.end();
  }
  void handle(req, res);
});
server.requestTimeout = 45000;
server.listen(5218, "127.0.0.1", () => process.send({ ready: true }));
