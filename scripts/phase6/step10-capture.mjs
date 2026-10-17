import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { parseCookieHeader } from "@supabase/ssr";
import { origin } from "./step10-live-policy.mjs";
import { read, seal, stop } from "./step10-private.mjs";
const dir = process.env.STEP10_PRIVATE,
  r = read(dir, "runtime.json"),
  p = read(dir, "manifest.json");
http
  .createServer(async (req, res) => {
    const send = (code, value) => {
      res.writeHead(code, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (req.headers.host !== "localhost:5206" || req.url !== "/__step10")
      return send(403, { blocked: true });
    if (req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
        "content-security-policy":
          "default-src 'none';script-src 'unsafe-inline';connect-src 'self';frame-ancestors 'none';base-uri 'none'",
      });
      return res.end(
        '<!doctype html><meta charset="utf-8"><title>STEP10 本人認証の確認</title><h1>STEP10 本人認証の確認</h1><p>現在のブラウザーの認証を新Supabaseだけで確認します。メール送信・登録・データ投入はしません。</p><button id="check">現在の認証を安全に確認</button><pre id="result">未確認</pre><script>check.onclick=async()=>{check.disabled=true;const r=await fetch(location.pathname,{method:"POST"});result.textContent=JSON.stringify(await r.json(),null,2)}</script>',
      );
    }
    if (
      req.method !== "POST" ||
      req.headers.origin !== "http://localhost:5206" ||
      fs.existsSync(path.join(dir, "STOP"))
    )
      return send(403, { blocked: true });
    try {
      const prefix = "sb-ukdzggjfkcwjssjmnqim-auth-token";
      const jar = parseCookieHeader(req.headers.cookie ?? "")
        .filter(
          (x) =>
            x.name === prefix ||
            new RegExp("^" + prefix + "\\.\\d+$").test(x.name),
        )
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
      const value = jar.map((x) => x.value).join("");
      if (!value)
        return send(200, {
          needsLogin: true,
          reason:
            "現在のブラウザーに認証Cookieがありません。データは未投入です。",
        });
      const session = JSON.parse(
        value.startsWith("base64-")
          ? Buffer.from(value.slice(7), "base64url").toString()
          : value,
      );
      const claims = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64url"),
      );
      if (claims.exp < Date.now() / 1000 + 1200)
        return send(200, {
          needsLogin: true,
          reason:
            "既存のAccess Tokenは検証に必要な残り時間が不足しています。自動更新はしていません。",
        });
      if (claims.iss !== origin + "/auth/v1" || !p.users.includes(claims.sub))
        throw Error();
      const rr = await fetch(origin + "/auth/v1/user", {
        headers: {
          apikey: r.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          authorization: "Bearer " + session.access_token,
        },
      });
      const user = await rr.json();
      if (!rr.ok || user.id !== claims.sub || !user.email_confirmed_at)
        throw Error();
      const label = user.id === p.users[0] ? "a" : "b";
      seal(dir, "session-" + label + ".aesgcm", {
        access_token: session.access_token,
        cookie: jar.map((x) => x.name + "=" + x.value).join("; "),
        expires: claims.exp,
      });
      send(200, {
        label,
        confirmed: true,
        encryptedSessionSaved: true,
        remainingSeconds: Math.floor(claims.exp - Date.now() / 1000),
      });
    } catch {
      stop(dir, "Capture mismatch");
      send(409, { stopped: true });
    }
  })
  .listen(5206, "127.0.0.1", () => console.log("STEP10 capture ready"));
