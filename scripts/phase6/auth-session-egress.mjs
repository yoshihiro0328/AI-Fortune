import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  origin,
  externalAllowed,
  reserveSignup,
  boundedBody,
} from "./auth-session-policy.mjs";
import { validateRuntime } from "./local-auth-policy.mjs";
const dir = process.argv[2],
  env = JSON.parse(fs.readFileSync(path.join(dir, "runtime.json"))),
  recipients = JSON.parse(fs.readFileSync(path.join(dir, "recipients.json")));
validateRuntime(env);
const known = new Set(),
  confirmed = new Set(),
  keys = [env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.SUPABASE_SERVICE_ROLE_KEY];
// UUID records originate only from prior authenticated provider responses.
for (const label of ["a", "b"]) {
  const f = path.join(dir, "user-" + label + ".json");
  if (fs.existsSync(f)) {
    const user = JSON.parse(fs.readFileSync(f));
    known.add(user.id);
    if (user.confirmed) confirmed.add(user.id);
  }
}
const stop = () =>
  fs.writeFileSync(path.join(dir, "STOP"), "Stopped: inspect without retry", {
    mode: 0o600,
  });
const server = http.createServer(async (req, res) => {
  const fail = (status = 403) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end('{"error":"STEP9_BLOCKED"}');
  };
  if (
    req.headers["x-step6-token"] !== env.PHASE6_PROXY_TOKEN ||
    !req.url.startsWith("/") ||
    req.url.startsWith("//") ||
    fs.existsSync(path.join(dir, "STOP"))
  )
    return fail();
  let raw, b;
  try {
    raw = await boundedBody(req);
    b = raw.length ? JSON.parse(raw) : {};
  } catch {
    return fail();
  }
  const target = origin + req.url,
    u = new URL(target);
  if (
    !externalAllowed(target, req.method, b) ||
    !keys.includes(req.headers.apikey)
  )
    return fail();
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!keys.includes(bearer)) {
    try {
      const jwt = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url"));
      if (
        jwt.iss !== origin + "/auth/v1" ||
        jwt.role !== "authenticated" ||
        !known.has(jwt.sub)
      )
        return fail();
    } catch {
      return fail();
    }
  }
  const label = Object.entries(recipients).find(
    ([, v]) => v === b.email?.trim().toLowerCase(),
  )?.[0];
  if (
    u.pathname === "/auth/v1/signup" ||
    (u.pathname === "/auth/v1/token" &&
      u.searchParams.get("grant_type") === "password")
  ) {
    if (!label) return fail();
  }
  if (u.pathname === "/auth/v1/signup") {
    if (fs.readFileSync(path.join(dir, "stage"), "utf8").trim() !== label)
      return fail();
    try {
      reserveSignup(dir, label);
    } catch {
      return fail();
    }
  }
  if (
    u.pathname === "/rest/v1/rpc/claim_anonymous_diagnoses" &&
    !confirmed.has(b.p_user)
  )
    return fail();
  if (
    u.pathname === "/rest/v1/profiles" &&
    req.headers.apikey !== env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    return fail();
  const invalidLoginFile = path.join(dir, "expected-invalid-login.once");
  let expectedInvalidLogin = false;
  if (
    u.pathname === "/auth/v1/token" &&
    u.searchParams.get("grant_type") === "password" &&
    fs.existsSync(invalidLoginFile)
  ) {
    if (fs.readFileSync(invalidLoginFile, "utf8").trim() !== label)
      return fail();
    fs.unlinkSync(invalidLoginFile);
    expectedInvalidLogin = true;
  }
  const negative =
    req.headers["x-step9-negative"] === "1" &&
    (u.pathname === "/auth/v1/user" ||
      (u.pathname === "/auth/v1/token" &&
        u.searchParams.get("grant_type") === "refresh_token"));
  const headers = {};
  for (const k of [
    "apikey",
    "authorization",
    "accept",
    "accept-profile",
    "content-type",
    "range",
    "range-unit",
    "prefer",
    "x-client-info",
    "x-supabase-api-version",
  ])
    if (req.headers[k]) headers[k] = req.headers[k];
  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: raw.length ? raw : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (expectedInvalidLogin && response.ok) {
      stop();
      return fail(502);
    }
    if (response.ok && u.pathname.startsWith("/auth/v1/")) {
      let data;
      try {
        data = JSON.parse(bytes);
      } catch {
        data = {};
      }
      const user = data.user ?? (data.id ? data : null);
      if (user) {
        const l = Object.entries(recipients).find(
          ([, v]) => v === user.email?.toLowerCase(),
        )?.[0];
        if (!l) {
          stop();
          return fail(502);
        }
        known.add(user.id);
        if (user.email_confirmed_at) confirmed.add(user.id);
        fs.writeFileSync(
          path.join(dir, "user-" + l + ".json"),
          JSON.stringify({ id: user.id, confirmed: !!user.email_confirmed_at }),
          { mode: 0o600 },
        );
      }
    }
    // Any upstream error freezes the run. Expected negative tests require separate, explicit preparation.
    if (
      !response.ok &&
      !(
        (negative || expectedInvalidLogin) &&
        [400, 401, 403].includes(response.status)
      )
    )
      stop();
    fs.appendFileSync(
      path.join(dir, "requests.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        path: u.pathname,
        method: req.method,
        status: response.status,
        label: label ?? null,
      }) + "\n",
      { mode: 0o600 },
    );
    res.writeHead(response.status, {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    });
    res.end(bytes);
  } catch {
    stop();
    fail(502);
  }
});
server.listen(5199, "127.0.0.1", () =>
  console.log("STEP9 scoped auth egress ready"),
);
