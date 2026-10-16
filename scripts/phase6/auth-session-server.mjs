import http from "node:http";
import fs from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import next from "next";
import { parseCookieHeader } from "@supabase/ssr";
import { sessionChecks } from "./auth-session-checks.mjs";
import { validateRuntime } from "./local-auth-policy.mjs";
import {
  recoveryCallbackAllowed,
  recoveryFlow,
} from "./auth-recovery-flows.mjs";
import {
  incomingAllowed as allowedIncoming,
  authActionAllowed,
  boundedBody,
  pkceCookiePresent,
} from "./auth-session-policy.mjs";
const dir = process.env.STEP9_PRIVATE;
const recipients = JSON.parse(
  fs.readFileSync(path.join(dir, "recipients.json")),
);
validateRuntime(process.env);
const app = next({
  dev: false,
  dir: process.cwd(),
  hostname: "localhost",
  port: 5198,
});
await app.prepare();
const handle = app.getRequestHandler();
http
  .createServer(async (req, res) => {
    const parsed = new URL(req.url, "http://localhost:5198");
    const pathname = parsed.pathname;
    const stage = fs.readFileSync(path.join(dir, "stage"), "utf8").trim();
    if (
      pathname === "/__step9-presence" &&
      req.method === "GET" &&
      req.headers.host === "localhost:5198"
    ) {
      const jar = parseCookieHeader(req.headers.cookie ?? "");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>PKCE確認</title><pre>' +
          JSON.stringify({
            pkceCookiePresent: pkceCookiePresent(jar),
            sessionCookiePresent: jar.some(
              (c) =>
                /^sb-ukdzggjfkcwjssjmnqim-auth-token(?:\.\d+)?$/.test(c.name) &&
                !!c.value,
            ),
          }) +
          "</pre>",
      );
      return;
    }
    if (
      pathname === "/__step9" &&
      req.method === "POST" &&
      !["sessions", "b-recovery-cleanup"].includes(stage)
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!recoveryCallbackAllowed(parsed, stage)) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
    if (await sessionChecks(req, res, dir)) return;
    if (!allowedIncoming(pathname, req.method, req.headers.host)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "STEP9_BLOCKED",
          message:
            "この検証では許可されていない操作です。再送は行わないでください。",
        }),
      );
      return;
    }
    if (req.method === "POST") {
      const flow = recoveryFlow(stage);
      let raw, input;
      try {
        raw = await boundedBody(req);
        input = JSON.parse(raw);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (
        req.headers.origin !== "http://localhost:5198" ||
        fs.existsSync(path.join(dir, "STOP")) ||
        !authActionAllowed(input, recipients, stage) ||
        (input.action === "reset" &&
          (!flow ||
            !flow.resetApprovalValid(dir, recipients[flow.label]) ||
            fs.existsSync(path.join(dir, flow.reservationFile)))) ||
        (input.action === "resend" &&
          (!pkceCookiePresent(parseCookieHeader(req.headers.cookie ?? "")) ||
            fs.existsSync(path.join(dir, "resend-b-1.reserved"))))
      ) {
        res.writeHead(403);
        res.end('{"error":"STEP9_BLOCKED"}');
        return;
      }
      // Reconstitute the consumed stream without changing the real API implementation.
      const replay = Readable.from([raw]);
      Object.assign(replay, {
        url: req.url,
        method: req.method,
        headers: req.headers,
        socket: req.socket,
        connection: req.socket,
        httpVersion: req.httpVersion,
      });
      handle(replay, res);
      return;
    }
    handle(req, res);
  })
  .listen(5198, "127.0.0.1", () =>
    console.log(
      "STEP9 app ready at http://localhost:5198 (stage-scoped, durable mail reservations)",
    ),
  );
