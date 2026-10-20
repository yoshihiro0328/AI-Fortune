import http from "node:http";
import next from "next";
import { routeName } from "../payment-verification/network.mjs";
// Runs only inside the OS sandbox. Parent owns its lifetime and never relays stdout.
if (!process.send || process.env.PAYMENT_INTEGRATION_LOCAL !== "true")
  throw new Error("SUPERVISOR_REQUIRED");
const app = next({
  dev: true,
  webpack: true,
  dir: process.cwd(),
  hostname: "localhost",
  port: 5208,
});
let server;
async function close() {
  if (server) server.closeAllConnections();
  await app.close();
  process.exit(0);
}
process.on("disconnect", close);
process.on("SIGTERM", close);
process.on("SIGINT", close);
process.on("message", (m) => {
  if (m === "stop") void close();
});
await app.prepare();
const handle = app.getRequestHandler();
server = http.createServer((req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  );
  if (!["localhost:5208", "127.0.0.1:5208"].includes(req.headers.host)) {
    res.writeHead(403);
    return res.end();
  }
  const path = new URL(req.url, "http://localhost:5208").pathname;
  const route = routeName(
    req.method,
    req.url,
    process.env.PAYMENT_INTEGRATION_DIAGNOSIS_ID,
  );
  res.once("finish", () =>
    process.send?.({
      http: {
        route: route ?? "denied",
        method: req.method,
        status: res.statusCode,
      },
    }),
  );
  if (!route) {
    process.send?.({ unsafeRequest: true });
    res.writeHead(403);
    return res.end();
  }
  if (path === "/payment-test/start/a" || path === "/payment-test/start/b") {
    if (req.method !== "GET" || req.headers.cookie?.includes("sb-")) {
      res.writeHead(403);
      return res.end();
    }
    const cookie =
      process.env[
        path.endsWith("/a") ? "PAYMENT_COOKIE_A" : "PAYMENT_COOKIE_B"
      ];
    res.setHeader(
      "Set-Cookie",
      `yorisoi_session=${cookie}; HttpOnly; SameSite=Lax; Path=/`,
    );
    res.writeHead(303, { Location: "/account" });
    return res.end();
  }
  if (
    path === "/api/webhooks/stripe" &&
    req.headers["x-payment-forward"] !== process.env.PAYMENT_FORWARD_TOKEN
  ) {
    res.writeHead(403);
    return res.end();
  }
  void handle(req, res);
});
server.requestTimeout = 45000;
server.listen(5208, "127.0.0.1", () => process.send({ ready: true }));
