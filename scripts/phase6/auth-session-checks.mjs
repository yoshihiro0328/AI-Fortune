/** Private localhost test panel. Real Supabase SDK, no admin auth and no token output. */
import fs from "node:fs";
import path from "node:path";
import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { boundedBody, origin } from "./auth-session-policy.mjs";
const snapshots = new Map();
export async function sessionChecks(req, res, dir) {
  const u = new URL(req.url, "http://localhost:5198");
  if (u.pathname !== "/__step9") return false;
  const finish = (code, result) => {
    res.writeHead(code, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(result));
  };
  if (req.headers.host !== "localhost:5198") {
    finish(403, { error: "host" });
    return true;
  }
  if (req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>認証セッション検証</title><style>body{font:18px sans-serif;padding:40px;line-height:1.8}button{margin:8px;padding:12px}pre{white-space:pre-wrap}</style><h1>認証セッション検証</h1><p>新Supabaseだけを対象に実行します。宛先・トークンは表示しません。メールは送信しません。</p><button data-action="refresh">セッション更新</button><button data-action="rls">プロフィールRLS確認</button><button data-action="invalid">無効トークン拒否</button><button data-action="snapshot">ログアウト前の状態を記憶</button><button data-action="after-a">Aのログアウト後検証</button><button data-action="after-b">Bのログアウト後検証</button><button data-action="clear">このブラウザーの認証Cookieを削除</button>${fs.readFileSync(path.join(dir, "stage"), "utf8").trim() === "b-recovery-cleanup" ? '<button data-action="recovery-logout-b">Bの再設定セッションを終了</button>' : ""}<pre id="result">未実行</pre><script>document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await fetch('/__step9',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:b.dataset.action})});document.querySelector('#result').textContent=JSON.stringify(await r.json(),null,2)}catch{document.querySelector('#result').textContent='通信失敗。再試行しないでください。' }});</script>`,
    );
    return true;
  }
  if (req.method !== "POST" || req.headers.origin !== "http://localhost:5198") {
    finish(403, { error: "csrf" });
    return true;
  }
  try {
    const { action } = JSON.parse(await boundedBody(req));
    const stage = fs.readFileSync(path.join(dir, "stage"), "utf8").trim();
    if ((action === "recovery-logout-b") !== (stage === "b-recovery-cleanup")) {
      finish(403, { error: "stage" });
      return true;
    }
    const jar = parseCookieHeader(req.headers.cookie ?? "");
    const auth = createServerClient(
      origin,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll: () => jar,
          setAll: (items) =>
            res.setHeader(
              "Set-Cookie",
              items.map(({ name, value, options }) =>
                serializeCookieHeader(name, value, {
                  ...options,
                  httpOnly: true,
                  secure: true,
                  sameSite: "lax",
                }),
              ),
            ),
        },
      },
    );
    const ids = Object.fromEntries(
      ["a", "b"].map((l) => [
        l,
        JSON.parse(fs.readFileSync(path.join(dir, "user-" + l + ".json"))).id,
      ]),
    );
    let result = {};
    const rawAuth = async (route, method, token, body, negative = false) => {
      const response = await fetch(origin + "/auth/v1/" + route, {
        method,
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          authorization: "Bearer " + token,
          "content-type": "application/json",
          ...(negative ? { "x-step9-negative": "1" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      // Never propagate provider bodies containing tokens or addresses.
      await response.arrayBuffer();
      return response.status;
    };
    if (action === "after-a" || action === "after-b") {
      const label = action.slice(-1),
        snapshot = snapshots.get(label);
      if (!snapshot) throw new Error("Missing snapshot");
      result = {
        label,
        accessTokenTimeRemaining: snapshot.exp > Math.floor(Date.now() / 1000),
        userEndpointStatus: await rawAuth(
          "user",
          "GET",
          snapshot.access_token,
          undefined,
          true,
        ),
        refreshAfterLogoutStatus: await rawAuth(
          "token?grant_type=refresh_token",
          "POST",
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          { refresh_token: snapshot.refresh_token },
          true,
        ),
      };
      snapshots.delete(label);
      if (![400, 401, 403].includes(result.refreshAfterLogoutStatus))
        throw new Error("Logged-out refresh token accepted");
    } else if (action === "clear") {
      res.setHeader(
        "Set-Cookie",
        jar
          .filter((c) => c.name.startsWith("sb-"))
          .map((c) =>
            serializeCookieHeader(c.name, "", {
              path: "/",
              maxAge: 0,
              httpOnly: true,
              secure: true,
              sameSite: "lax",
            }),
          ),
      );
      result = { cookiesCleared: true };
    } else {
      const {
        data: { user },
        error,
      } = await auth.auth.getUser();
      if (error || !user?.email_confirmed_at)
        throw new Error("Not authenticated");
      const label = Object.keys(ids).find((l) => ids[l] === user.id);
      if (!label) throw new Error("Unknown user");
      if (action === "recovery-logout-b") {
        if (label !== "b")
          throw new Error("Only B recovery sessions may be closed");
        const { error } = await auth.auth.signOut({ scope: "global" });
        if (error) throw new Error("B session cleanup failed");
        result = { label: "b", globalLogoutSucceeded: true };
      } else if (action === "refresh") {
        const before = (await auth.auth.getSession()).data.session;
        const refreshed = await auth.auth.refreshSession();
        if (
          refreshed.error ||
          !refreshed.data.session ||
          refreshed.data.user?.id !== user.id
        )
          throw new Error("Refresh failed");
        result = {
          label,
          refreshed: true,
          sameUser: refreshed.data.user.id === user.id,
          refreshTokenRotated:
            before.refresh_token !== refreshed.data.session.refresh_token,
        };
      } else if (action === "rls") {
        const own = await auth
          .from("profiles")
          .select("user_id")
          .eq("user_id", user.id);
        const other = await auth
          .from("profiles")
          .select("user_id")
          .eq("user_id", ids[label === "a" ? "b" : "a"]);
        const all = await auth.from("profiles").select("user_id");
        if (own.error || other.error || all.error)
          throw new Error("RLS query failed");
        result = {
          label,
          ownCount: own.data.length,
          otherCount: other.data.length,
          allVisibleRowsBelongToSelf: all.data.every(
            (r) => r.user_id === user.id,
          ),
        };
        if (
          result.ownCount !== 1 ||
          result.otherCount !== 0 ||
          !result.allVisibleRowsBelongToSelf
        )
          throw new Error("RLS failed");
      } else if (action === "invalid" || action === "snapshot") {
        const {
          data: { session },
        } = await auth.auth.getSession();
        if (!session) throw new Error("Missing session");
        const claims = JSON.parse(
          Buffer.from(session.access_token.split(".")[1], "base64url"),
        );
        if (action === "snapshot") {
          snapshots.set(label, {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            exp: claims.exp,
          });
          result = {
            label,
            snapshotInMemory: true,
            accessLifetimeSeconds: claims.exp - claims.iat,
          };
        } else {
          const parts = session.access_token.split(".");
          parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
          const status = await rawAuth(
            "user",
            "GET",
            parts.join("."),
            undefined,
            true,
          );
          result = {
            label,
            invalidTokenRejected: [401, 403].includes(status),
            status,
          };
          if (!result.invalidTokenRejected)
            throw new Error("Invalid token accepted");
        }
      } else throw new Error("Unapproved action");
    }
    fs.appendFileSync(
      path.join(dir, "session-results.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), action, ...result }) +
        "\n",
      { mode: 0o600 },
    );
    finish(200, result);
  } catch {
    fs.writeFileSync(path.join(dir, "STOP"), "Session check failed", {
      mode: 0o600,
    });
    finish(409, { error: "停止しました。再試行せず確認してください。" });
  }
  return true;
}
