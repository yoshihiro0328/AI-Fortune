import { allowedExternal } from "./local-auth-policy.mjs";
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init);
  if (!allowedExternal(req.url, req.method))
    throw new Error("STEP6 outbound request blocked");
  const u = new URL(req.url),
    headers = new Headers(req.headers);
  headers.set("x-step6-token", process.env.PHASE6_PROXY_TOKEN);
  return original("http://127.0.0.1:5199" + u.pathname + u.search, {
    method: req.method,
    headers,
    redirect: "error",
    signal: req.signal,
  });
};
