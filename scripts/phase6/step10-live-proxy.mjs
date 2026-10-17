import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  context,
  origin,
  externalAllowed,
  roleOf,
} from "./step10-live-policy.mjs";
import { tables } from "./step10-fixtures.mjs";
import { read, unseal, stop } from "./step10-private.mjs";
const dir = process.argv[2],
  r = read(dir, "runtime.json"),
  c = context(r, read(dir, "manifest.json"), unseal(dir, "anonymous.aesgcm"));
http
  .createServer(async (req, res) => {
    const fail = () => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end('{"error":"STEP10_BLOCKED"}');
    };
    if (
      fs.existsSync(path.join(dir, "STOP")) ||
      req.headers["x-step10-control"] !== r.PHASE6_PROXY_TOKEN ||
      !req.url.startsWith("/") ||
      req.url.startsWith("//")
    )
      return fail();
    let raw = Buffer.alloc(0),
      body = {};
    try {
      for await (const chunk of req) {
        raw = Buffer.concat([raw, chunk]);
        if (raw.length > 20000) throw Error();
      }
      if (raw.length) body = JSON.parse(raw);
    } catch {
      return fail();
    }
    const role = roleOf(
      req.headers.apikey,
      (req.headers.authorization ?? "").replace(/^Bearer /, ""),
      c,
    );
    const stage = fs.readFileSync(path.join(dir, "stage"), "utf8").trim(),
      target = origin + req.url;
    if (!externalAllowed(target, req.method, body, c, role, stage))
      return fail();
    const u = new URL(target);
    const expectedReject =
      role === "invalid" ||
      (role === "anon" && tables.some((t) => u.pathname === "/rest/v1/" + t)) ||
      req.method === "PATCH" ||
      (u.pathname.endsWith("/claim_anonymous_diagnoses") && role !== "service");
    try {
      const headers = {};
      for (const k of [
        "apikey",
        "authorization",
        "content-type",
        "accept",
        "prefer",
        "range",
        "range-unit",
        "x-client-info",
        "x-supabase-api-version",
      ])
        if (req.headers[k]) headers[k] = req.headers[k];
      const rr = await fetch(target, {
        method: req.method,
        headers,
        body: raw.length ? raw : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      const bytes = Buffer.from(await rr.arrayBuffer());
      fs.appendFileSync(
        path.join(dir, "requests.jsonl"),
        JSON.stringify({
          at: new Date().toISOString(),
          method: req.method,
          path: u.pathname,
          role,
          status: rr.status,
          expectedReject,
        }) + "\n",
        { mode: 0o600 },
      );
      if (
        (expectedReject && ![401, 403].includes(rr.status)) ||
        (!expectedReject && !rr.ok)
      ) {
        stop(dir, "Unexpected provider status");
        res.writeHead(502);
        return res.end('{"error":"STEP10_STOP"}');
      }
      res.writeHead(rr.status, {
        "content-type": rr.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      });
      res.end(bytes);
    } catch {
      stop(dir, "Unknown network outcome");
      res.writeHead(502);
      res.end('{"error":"STEP10_STOP"}');
    }
  })
  .listen(5209, "127.0.0.1", () => console.log("STEP10 scoped relay ready"));
