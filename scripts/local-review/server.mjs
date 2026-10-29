import http from "node:http";
import next from "next";
import fs from "node:fs";
import v8 from "node:v8";
import { createFixture } from "./fixtures.mjs";
const host = "127.0.0.1",
  port = 5318,
  origin = `http://${host}:${port}`;
if (
  process.env.LOCAL_REVIEW_ISOLATED !== "true" ||
  process.env.NODE_ENV !== "production" ||
  !fs.existsSync(".next/BUILD_ID") ||
  process.env.VERCEL ||
  process.env.OPENAI_API_KEY ||
  process.env.STRIPE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
  throw Error("LOCAL_REVIEW_CONFIGURATION_REJECTED");
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (u.origin !== origin) throw Error("LOCAL_REVIEW_EXTERNAL_NETWORK_DENIED");
  return realFetch(input, init);
};
const fixture = createFixture(process.cwd());
const app = next({
  dev: false,
  hostname: host,
  port,
  quiet: true,
});
await app.prepare();
const handle = app.getRequestHandler();
const csp =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.headers.host !== `${host}:${port}`) {
      res.writeHead(403);
      return res.end();
    }
    const u = new URL(req.url, origin),
      method = req.method;
    if (!["GET", "HEAD"].includes(method) && req.headers.origin !== origin) {
      res.writeHead(403);
      return res.end();
    }
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (u.pathname === "/__review/health")
      return json(200, {
        ready: true,
        synthetic: true,
        mode: fixture.mode,
        external: false,
        runtime: "production-build",
        build: fs.readFileSync(".next/BUILD_ID", "utf8").trim(),
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage(),
        heapLimitBytes: v8.getHeapStatistics().heap_size_limit,
      });
    if (u.pathname === "/__review/scenario" && method === "POST") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1000) {
          res.writeHead(413);
          return res.end();
        }
      }
      if (!fixture.reset(new URLSearchParams(body).get("mode"))) {
        res.writeHead(400);
        return res.end();
      }
      res.writeHead(303, { Location: "/account" });
      return res.end();
    }
    if (u.pathname === "/__review/portal" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(
        '<!doctype html><html lang="ja"><meta charset="utf-8"><title>Portalの合成表示</title><main><h1>Portalの合成表示</h1><p>Stripeへは接続していません。契約・支払方法の変更はできません。これは復帰導線の表示確認であり、実Portalの検証ではありません。</p><a href="/account">よりそいのマイページへ戻る</a></main></html>',
      );
    }
    if (u.pathname.startsWith("/api/")) {
      let b = {},
        raw = "";
      if (!["GET", "HEAD"].includes(method)) {
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 16384)
            return json(413, { error: "合成入力の上限です。" });
        }
        try {
          b = JSON.parse(raw || "{}");
        } catch {
          return json(400, { error: "入力形式が正しくありません。" });
        }
      }
      const result = fixture.handle(method, u, b);
      return json(result.status, result.data);
    }
    if (
      !["GET", "HEAD"].includes(method) ||
      /^\/(auth|admin|preview-demo)(\/|$)/.test(u.pathname) ||
      u.pathname.startsWith("/_next/image")
    )
      return json(403, { error: "LOCAL_REVIEW_BLOCKED" });
    await handle(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end("LOCAL_REVIEW_REQUEST_FAILED");
  }
});
// Production review has no HMR sockets or compiler/watch process.
server.on("upgrade", (_req, socket) => socket.destroy());
server.listen(port, host, () => console.log("LOCAL_REVIEW_READY"));
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    server.close(async () => {
      await app.close();
      clearTimeout(deadline);
      process.exit(0);
    });
    server.closeAllConnections();
  });
