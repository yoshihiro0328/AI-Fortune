import { origin, externalAllowed } from "./auth-session-policy.mjs";
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init);
  let text = "",
    body = {};
  if (!["GET", "HEAD"].includes(req.method)) {
    text = await req.text();
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("STEP9 invalid body");
    }
  }
  if (!externalAllowed(req.url, req.method, body))
    throw new Error("STEP9 outbound blocked");
  const u = new URL(req.url);
  if (u.origin !== origin) throw new Error("STEP9 wrong target");
  const headers = new Headers(req.headers);
  headers.set("x-step6-token", process.env.PHASE6_PROXY_TOKEN);
  return original("http://127.0.0.1:5199" + u.pathname + u.search, {
    method: req.method,
    headers,
    body: text || undefined,
    redirect: "error",
    signal: req.signal,
  });
};
