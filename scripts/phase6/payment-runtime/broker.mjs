import http from "node:http";
import Stripe from "stripe";
import { TARGET, insist } from "./policy.mjs";
export async function bounded(stream, max = 300000) {
  const chunks = [];
  let n = 0;
  for await (const chunk of stream) {
    n += chunk.length;
    insist(n <= max, "BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function providerTransport(secrets) {
  return async (r) => {
    const u = new URL(r.url);
    insist([TARGET.supabase, TARGET.stripe].includes(u.origin));
    const source = new Headers(r.headers),
      h = new Headers();
    // Discard all non-enumerated headers, notably routing overrides and forwarded credentials.
    for (const k of [
      "content-type",
      "accept",
      "prefer",
      "stripe-version",
      "idempotency-key",
      "range",
      "range-unit",
    ])
      if (source.has(k)) h.set(k, source.get(k));
    if (u.origin === TARGET.stripe)
      h.set("authorization", "Bearer " + secrets.stripe);
    else {
      const key =
        source.get("apikey") === "local-service"
          ? secrets.service
          : secrets.anon;
      h.set("apikey", key);
      const bearer = source.get("authorization")?.replace(/^Bearer /, "");
      h.set(
        "authorization",
        "Bearer " +
          (["local-anon", "local-service"].includes(bearer) ? key : bearer),
      );
    }
    const response = await fetch(r.url, {
      method: r.method,
      headers: h,
      body: r.body || undefined,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    insist(text.length <= 1000000, "UPSTREAM_TOO_LARGE");
    return { status: response.status, text };
  };
}
export async function startBroker({
  policy,
  transport,
  token,
  webhookSecret,
  forwardToken,
  forward,
  port = 5209,
  onStop = () => {},
  onDeny = () => {},
  onAccepted = () => {},
  onWebhookSuccess = () => {},
}) {
  const stripe = new Stripe("rk_test_local_proxy");
  let chain = Promise.resolve();
  let stopped = false;
  const serial = (fn) => {
    const work = chain.then(fn);
    chain = work.catch(() => {});
    return work;
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      insist(!stopped && req.method === "POST");
      if (req.url === "/proxy") {
        insist(req.headers["x-payment-token"] === token);
        const request = JSON.parse(await bounded(req));
        const result = await serial(async () => {
          const t = policy.authorize(request);
          try {
            const out = await transport(request);
            const parsed = out.text ? JSON.parse(out.text) : null;
            policy.accept(t, out.status, parsed);
            onAccepted(t, parsed);
            return out;
          } catch {
            policy.stopped = true;
            onStop("UPSTREAM_OR_RESPONSE_FAILURE");
            throw new Error("UPSTREAM_OR_RESPONSE_FAILURE");
          }
        });
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(result.text);
      } else if (req.url === "/webhook") {
        const raw = await bounded(req),
          signature = req.headers["stripe-signature"];
        const event = stripe.webhooks.constructEvent(
          raw,
          signature ?? "",
          webhookSecret(),
        );
        try {
          await serial(async () => policy.signedEvent(event, raw));
        } catch {
          onStop("UNEXPECTED_SIGNED_EVENT");
          throw new Error("SIGNED_EVENT_STOP");
        }
        // Do not hold the serial queue while Next processes the webhook through this broker.
        let response;
        try {
          response = await forward(raw, signature, forwardToken);
          insist(response.status >= 200 && response.status < 300);
          onWebhookSuccess(raw, signature);
        } catch {
          onStop("WEBHOOK_RESULT_UNKNOWN_OR_FAILED");
          throw new Error("WEBHOOK_STOP");
        }
        res.writeHead(response.status, { "content-type": "application/json" });
        res.end(response.text);
      } else insist(false);
    } catch {
      onDeny();
      // No raw provider errors, bodies, tokens or URL query strings in logs/responses.
      res.writeHead(403, { "content-type": "application/json" });
      res.end('{"error":"PAYMENT_RUNTIME_STOP"}');
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    port: server.address().port,
    async stop() {
      stopped = true;
      policy.stopped = true;
      await Promise.race([
        chain,
        new Promise((r) => setTimeout(r, 16000).unref()),
      ]);
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
