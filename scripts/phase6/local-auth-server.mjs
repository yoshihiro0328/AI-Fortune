import http from "node:http";
import next from "next";
import { allowedIncoming, validateRuntime } from "./local-auth-policy.mjs";
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
  .createServer((req, res) => {
    const path = new URL(req.url, "http://localhost:5198").pathname;
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
    if (!allowedIncoming(path, req.method, req.headers.host)) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "STEP6_READ_ONLY",
          message:
            "現在は表示確認のみです。登録・送信・保存は承認待ちのため停止しています。",
        }),
      );
      return;
    }
    handle(req, res);
  })
  .listen(5198, "127.0.0.1", () =>
    console.log("STEP6 app ready at http://localhost:5198 (writes blocked)"),
  );
