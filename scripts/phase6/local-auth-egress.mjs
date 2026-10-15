import http from "node:http";
import fs from "node:fs";
import {
  origin,
  allowedExternal,
  validateRuntime,
} from "./local-auth-policy.mjs";
const env = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
validateRuntime(env);
const keys = [env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.SUPABASE_SERVICE_ROLE_KEY];
const server = http.createServer(async (req, res) => {
  const target = origin + req.url;
  const token = req.headers["x-step6-token"];
  if (
    !env.PHASE6_PROXY_TOKEN ||
    token !== env.PHASE6_PROXY_TOKEN ||
    !req.url.startsWith("/") ||
    req.url.startsWith("//") ||
    !allowedExternal(target, req.method)
  ) {
    res.writeHead(403);
    res.end("STEP6_READ_ONLY");
    return;
  }
  const headers = {};
  for (const k of [
    "apikey",
    "authorization",
    "accept",
    "accept-profile",
    "range",
    "range-unit",
    "prefer",
  ])
    if (req.headers[k]) headers[k] = req.headers[k];
  if (
    !keys.includes(headers.apikey) ||
    (headers.authorization &&
      !keys.includes(headers.authorization.replace(/^Bearer /, "")))
  ) {
    res.writeHead(403);
    res.end("STEP6_KEY_MISMATCH");
    return;
  }
  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    console.log(
      JSON.stringify({
        host: new URL(origin).hostname,
        path: new URL(target).pathname,
        method: req.method,
        status: response.status,
      }),
    );
    res.writeHead(response.status, {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    console.log("upstream_read_failed");
    res.writeHead(502);
    res.end("STEP6_UPSTREAM_FAILED");
  }
});
server.listen(5199, "127.0.0.1", () =>
  console.log("STEP6 read-only egress ready"),
);
