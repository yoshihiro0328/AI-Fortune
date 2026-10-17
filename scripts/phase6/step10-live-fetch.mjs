import { origin } from "./step10-live-policy.mjs";
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const r = new Request(input, init),
    u = new URL(r.url);
  if (u.origin === "http://127.0.0.1:5208") return original(r);
  if (u.origin !== origin || u.username || u.password || u.hash)
    throw Error("STEP10 outbound blocked");
  const h = new Headers(r.headers);
  h.set("x-step10-control", process.env.PHASE6_PROXY_TOKEN);
  return original("http://127.0.0.1:5209" + u.pathname + u.search, {
    method: r.method,
    headers: h,
    body: ["GET", "HEAD"].includes(r.method) ? undefined : await r.text(),
    redirect: "error",
    signal: r.signal,
  });
};
