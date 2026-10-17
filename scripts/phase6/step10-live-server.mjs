import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import next from "next";
import { context, incomingAllowed } from "./step10-live-policy.mjs";
import { read, unseal } from "./step10-private.mjs";
const dir = process.env.STEP10_PRIVATE,
  r = read(dir, "runtime.json");
context(r, read(dir, "manifest.json"), unseal(dir, "anonymous.aesgcm"));
const app = next({
  dev: false,
  dir: process.cwd(),
  hostname: "localhost",
  port: 5208,
});
await app.prepare();
const handle = app.getRequestHandler();
http
  .createServer(async (req, res) => {
    const fail = () => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end('{"error":"STEP10_BLOCKED"}');
    };
    if (
      req.headers["x-step10-control"] !== r.PHASE6_PROXY_TOKEN ||
      !["localhost:5208", "127.0.0.1:5208"].includes(req.headers.host) ||
      fs.existsSync(path.join(dir, "STOP"))
    )
      return fail();
    const u = new URL(req.url, "http://localhost:5208");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && u.pathname === "/__health")
      return res.end('{"ready":true}');
    if (fs.readFileSync(path.join(dir, "stage"), "utf8").trim() !== "run")
      return fail();
    let raw = Buffer.alloc(0),
      body = {};
    if (req.method === "POST") {
      try {
        for await (const chunk of req) {
          raw = Buffer.concat([raw, chunk]);
          if (raw.length > 20000) throw Error();
        }
        body = JSON.parse(raw);
      } catch {
        return fail();
      }
    }
    if (!incomingAllowed(u.pathname, req.method, body)) return fail();
    if (req.method === "POST") {
      const replay = Readable.from([raw]);
      Object.assign(replay, {
        url: req.url,
        method: req.method,
        headers: req.headers,
        socket: req.socket,
        connection: req.socket,
        httpVersion: req.httpVersion,
      });
      return handle(replay, res);
    }
    handle(req, res);
  })
  .listen(5208, "127.0.0.1", () =>
    console.log("STEP10 real application API ready; controlled requests only"),
  );
