import { TARGET, check } from "./policy.mjs";
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const r = new Request(input, init);
  check(
    [TARGET.supabase, TARGET.stripe].includes(new URL(r.url).origin),
    "EGRESS_DENIED",
  );
  return original(TARGET.broker + "/proxy", {
    method: "POST",
    headers: { "x-payment-token": process.env.SUBSCRIPTION_PROXY_TOKEN },
    body: JSON.stringify({
      url: r.url,
      method: r.method,
      headers: Object.fromEntries(r.headers),
      body: ["GET", "HEAD"].includes(r.method) ? "" : await r.text(),
    }),
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(18000), r.signal]),
  });
};
