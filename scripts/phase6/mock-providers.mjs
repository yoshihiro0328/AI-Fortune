// Test-process preload only. Never imported by application code or deployed.
// Fail closed: the running Next server can open sockets only to loopback.
import fs from "node:fs";
import crypto from "node:crypto";
import net from "node:net";
if (!process.env.PHASE6_MOCK_STATE || !process.env.PHASE6_REST_URL)
  throw new Error("Isolated harness configuration required");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host =
    typeof a === "object"
      ? a.host
      : typeof args[1] === "string"
        ? args[1]
        : undefined;
  if (host && !["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error("Non-loopback socket blocked by integration harness");
  return connect.apply(this, args);
};
const original = globalThis.fetch;
const state = () =>
  JSON.parse(fs.readFileSync(process.env.PHASE6_MOCK_STATE, "utf8"));
function event(name) {
  fs.appendFileSync(process.env.PHASE6_MOCK_EVENTS, name + "\n");
}
function json(value, status = 200) {
  return Promise.resolve(Response.json(value, { status }));
}
globalThis.fetch = async (input, init) => {
  const raw =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
  const u = new URL(raw);
  const s = state();
  if (u.origin === process.env.NEXT_PUBLIC_SUPABASE_URL) {
    if (u.pathname.startsWith("/rest/v1/")) {
      event("database");
      return original(
        process.env.PHASE6_REST_URL +
          u.pathname.slice("/rest/v1".length) +
          u.search,
        init,
      );
    }
    if (u.pathname === "/auth/v1/user") {
      event("auth");
      const headers = new Headers(init?.headers ?? input.headers);
      const token = (headers.get("authorization") ?? "").replace(
        /^Bearer /,
        "",
      );
      const parts = token.split(".");
      const expected = crypto
        .createHmac("sha256", process.env.PHASE6_JWT_SECRET)
        .update(parts.slice(0, 2).join("."))
        .digest("base64url");
      if (parts.length !== 3 || expected !== parts[2])
        return json({ message: "Invalid synthetic token" }, 401);
      const payload = JSON.parse(Buffer.from(parts[1], "base64url"));
      const user = s.users[payload.sub];
      if (!user || payload.exp < Date.now() / 1000)
        return json({ message: "Invalid synthetic identity" }, 401);
      return json(user);
    }
  }
  if (u.href === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    event("challenge");
    return json({
      success: s.challenge !== "reject",
      hostname: "127.0.0.1",
      action: "trial_session",
      challenge_ts: new Date().toISOString(),
    });
  }
  if (u.origin === "https://api.openai.com") {
    const body = JSON.parse(init.body);
    if (u.pathname === "/v1/responses/input_tokens") {
      event("count");
      return json({ input_tokens: s.mode === "oversize" ? 3001 : 200 });
    }
    if (u.pathname === "/v1/responses") {
      event("generation");
      if (
        body.store !== false ||
        body.max_output_tokens !== 1200 ||
        body.service_tier !== "default"
      )
        throw new Error("Provider safety parameters changed");
      if (s.delay) await new Promise((resolve) => setTimeout(resolve, s.delay));
      if (s.mode === "timeout")
        throw new Error("Synthetic connection loss after send");
      return json({
        id: "resp_synthetic",
        object: "response",
        created_at: 1,
        status: "completed",
        model: s.mode === "anomaly" ? "unexpected-model" : body.model,
        service_tier: "default",
        usage: { input_tokens: 200, output_tokens: 100 },
        output: [
          {
            type: "message",
            id: "msg_synthetic",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                annotations: [],
                text: JSON.stringify({
                  answer:
                    s.mode === "invalid"
                      ? ""
                      : "合成回答です。短い近況と答えやすい質問を一つ添えましょう。",
                  safety: false,
                }),
              },
            ],
          },
        ],
      });
    }
  }
  // Framework requests to the local test server only. No permissive external fallback.
  if (u.origin === process.env.NEXT_PUBLIC_APP_URL)
    return original(input, init);
  event("blocked");
  throw new Error("Unexpected outbound request blocked by integration harness");
};
