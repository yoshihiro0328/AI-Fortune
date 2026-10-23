import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { check } from "./policy.mjs";

// Only the human opens this page. Never inspect its DOM, screenshots, clipboard,
// or request bodies. This loopback receiver makes no outbound requests.
export async function keyReceiver({
  directory,
  onSubmission = () => {},
  purpose = "trial",
}) {
  check(["trial", "post-close"].includes(purpose), "RECEIVER_PURPOSE_DENIED");
  const roles =
    purpose === "post-close" ? ["app"] : ["listener", "app", "lifecycle"];
  const title =
    purpose === "post-close"
      ? "終了後検証：1件のキーの安全な受渡し"
      : "Plus検証：3用途のキーの安全な受渡し";
  const st = fs.lstatSync(directory);
  check(
    st.isDirectory() &&
      !st.isSymbolicLink() &&
      st.uid === process.getuid() &&
      !(st.mode & 0o077),
    "PRIVATE_DIRECTORY_REQUIRED",
  );
  const target = path.join(directory, "stripe-keys.json");
  check(!fs.existsSync(target), "RECEIVER_ALREADY_USED");
  const route = "/" + randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  let received = false,
    busy = false,
    failed = false,
    closed = false;
  let origin;
  const page = `<!doctype html><html lang="ja"><meta charset="utf-8">
<title>${title}</title>
<style>body{font:18px sans-serif;max-width:720px;margin:36px auto;padding:20px;line-height:1.7}input,button{display:block;font:inherit;padding:12px;width:100%;box-sizing:border-box;margin:12px 0}</style>
<h1>${title}</h1>
<p>yorisoi-integration-test<br>acct_1UQlQdI73kTcvXz8</p>
<p>本人だけが入力してください。標準キーは使いません。画面や値をチャットへ送らないでください。</p>
<form method="post" autocomplete="off"><input type="hidden" name="csrf" value="${csrf}">
${roles.map((role) => `<label>${{ listener: "受信用キー", app: purpose === "post-close" ? "終了後検証用キー" : "アプリ用キー", lifecycle: "準備・終了用キー" }[role]}<input type="password" name="${role}" required autocomplete="off"></label>`).join("")}
<button type="submit">${roles.length}件を安全に渡す</button></form>
<p>送信先はこのMac内のみです。アクセスを限定した一時ファイルに保存し、作業終了時に削除します。</p></html>`;
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // no-referrer turns a native form POST's Origin into "null".
        // Preserve same-origin submissions without disclosing referrers externally.
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      });
      res.end(body);
    };
    if (req.headers.host !== origin.slice(7) || req.url !== route)
      return reply(404, "Not found");
    if (closed || failed)
      return reply(503, "受渡し処理を停止しました。再送しないでください。");
    if (req.method === "GET")
      return reply(
        200,
        received
          ? "<h1>安全に受け取りました</h1><p>再入力は不要です。</p>"
          : page,
      );
    if (req.method !== "POST") return reply(405, "Method not allowed");
    if (
      req.headers.origin !== origin ||
      req.headers["content-type"]?.split(";")[0] !==
        "application/x-www-form-urlencoded"
    )
      return reply(403, "受け付けられませんでした。");
    if (received || busy)
      return reply(409, "既に受取処理済みです。再送しないでください。");
    busy = true;
    try {
      try {
        onSubmission();
      } catch {
        failed = true;
        throw Error("RECEIVER_WINDOW_FAILED");
      }
      const length = Number(req.headers["content-length"]);
      check(Number.isInteger(length) && length > 0 && length < 8192);
      const chunks = [];
      let n = 0;
      for await (const c of req) {
        n += c.length;
        check(n <= length && n < 8192);
        chunks.push(c);
      }
      check(n === length);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      check(
        [...form.keys()].sort().join(",") ===
          [...roles, "csrf"].sort().join(","),
      );
      const supplied = Buffer.from(form.get("csrf") ?? ""),
        expected = Buffer.from(csrf);
      check(
        supplied.length === expected.length &&
          timingSafeEqual(supplied, expected),
      );
      const keys = Object.fromEntries(roles.map((k) => [k, form.get(k)]));
      check(
        Object.values(keys).every((v) =>
          /^rk_test_[A-Za-z0-9]{24,500}$/.test(v),
        ),
      );
      check(new Set(Object.values(keys)).size === roles.length);
      check(!closed, "RECEIVER_CLOSED");
      const fd = fs.openSync(target, "wx", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(keys));
        fs.fsyncSync(fd);
        received = true;
      } catch {
        failed = true;
        throw Error("RECEIVER_WRITE_FAILED");
      } finally {
        fs.closeSync(fd);
      }
      reply(
        200,
        "<h1>安全に受け取りました</h1><p>値をチャットへ送らず、この画面を閉じてください。</p>",
      );
    } catch {
      reply(
        failed ? 503 : 400,
        failed
          ? "保存結果を確認できません。再送しないでください。"
          : `新しい制限付きテストキーを${roles.length}件、対応する欄へ入力してください。入力は保存していません。`,
      );
    } finally {
      busy = false;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: origin + route,
    status: () => ({ received, failed }),
    close: async () => {
      closed = true;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
