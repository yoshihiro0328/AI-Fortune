import fs from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = parseEnv(fs.readFileSync(".env.local", "utf8"));
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
class BrowserSession {
  jar = new Map();
  async call(path, data, origin = base) {
    const headers = {
      origin,
      cookie: [...this.jar].map(([k, v]) => k + "=" + v).join("; "),
    };
    if (data !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: "manual",
    });
    for (const c of r.headers.getSetCookie()) {
      const part = c.split(";")[0],
        idx = part.indexOf("=");
      this.jar.set(part.slice(0, idx), part.slice(idx + 1));
    }
    const content = await r.json();
    return { status: r.status, data: content };
  }
}
const a = new BrowserSession(),
  b = new BrowserSession();
const password = "Test" + randomBytes(20).toString("hex") + "9!";
const email = "yorisoi-auth-" + randomUUID() + "@example.com";
function ok(label, condition) {
  assert.ok(condition, label);
  console.log("PASS " + label);
}
async function link(type, address, passwordValue) {
  const { data, error } = await admin.auth.admin.generateLink({
    type,
    email: address,
    ...(passwordValue ? { password: passwordValue } : {}),
  });
  if (error) throw new Error("Test token generation failed: " + error.code);
  return data;
}
const start = await a.call("/api/diagnoses", {});
ok("anonymous diagnosis creation", start.status === 200);
const id = start.data.id;
ok(
  "CSRF auth rejected",
  (await a.call("/api/auth", { action: "logout" }, "https://example.invalid"))
    .status === 403,
);
const created = await link("signup", email, password);
ok(
  "unconfirmed login rejected",
  (await a.call("/api/auth", { action: "login", email, password })).status ===
    400,
);
ok(
  "real Supabase signup token verification",
  (
    await a.call("/api/auth/confirm", {
      token_hash: created.properties.hashed_token,
      type: "signup",
    })
  ).status === 200,
);
ok(
  "session maintained",
  (await a.call("/api/auth")).data.user?.confirmed === true,
);
ok(
  "anonymous claim",
  (await a.call("/api/auth", { action: "claim" })).data.count === 1,
);
ok(
  "claim is idempotent",
  (await a.call("/api/auth", { action: "claim" })).data.count === 0,
);
ok(
  "history lists own diagnosis",
  (await a.call("/api/diagnoses")).data.some((d) => d.id === id),
);
ok(
  "unpaid report denied",
  (await a.call("/api/diagnoses/" + id + "/report")).status === 403,
);
ok("logout", (await a.call("/api/auth", { action: "logout" })).status === 200);
ok(
  "linked diagnosis requires login",
  (await a.call("/api/diagnoses/" + id)).status === 404,
);
ok(
  "password login",
  (await a.call("/api/auth", { action: "login", email, password })).status ===
    200,
);
ok(
  "saved diagnosis accessible after login",
  (await a.call("/api/diagnoses/" + id)).status === 200,
);
const emailB = "yorisoi-other-" + randomUUID() + "@example.com";
const other = await link("signup", emailB, password);
ok(
  "second user confirmed",
  (
    await b.call("/api/auth/confirm", {
      token_hash: other.properties.hashed_token,
      type: "signup",
    })
  ).status === 200,
);
ok(
  "IDOR diagnosis denied",
  (await b.call("/api/diagnoses/" + id)).status === 404,
);
ok(
  "IDOR paid report denied",
  (await b.call("/api/diagnoses/" + id + "/report")).status === 404,
);
const userClient = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
await userClient.auth.signInWithPassword({ email: emailB, password });
const rows = await userClient.from("diagnoses").select("id").eq("id", id);
ok("RLS via authenticated Data API", !rows.error && rows.data.length === 0);
ok(
  "password update requires recovery",
  (await a.call("/api/auth", { action: "update", password: password + "1" }))
    .status === 403,
);
const recovery = await link("recovery", email);
ok(
  "recovery email token verified",
  (
    await a.call("/api/auth/confirm", {
      token_hash: recovery.properties.hashed_token,
      type: "recovery",
    })
  ).status === 200,
);
ok("recovery mode enabled", (await a.call("/api/auth")).data.recovery === true);
ok(
  "password reset",
  (await a.call("/api/auth", { action: "update", password: password + "1" }))
    .status === 200,
);
ok(
  "reset signs out current session",
  (await a.call("/api/auth")).data.user === null,
);
ok(
  "old password rejected",
  (await a.call("/api/auth", { action: "login", email, password })).status ===
    400,
);
ok(
  "new password accepted",
  (
    await a.call("/api/auth", {
      action: "login",
      email,
      password: password + "1",
    })
  ).status === 200,
);
const invalid = new BrowserSession();
ok(
  "invalid confirmation rejected",
  (
    await invalid.call("/api/auth/confirm", {
      type: "signup",
      token_hash: "x".repeat(40),
    })
  ).status === 400,
);
console.log(
  "NOTE: tokens created by Supabase admin.generateLink; email delivery/SMTP is NOT validated by this test.",
);
console.log(
  JSON.stringify({
    diagnosis: id,
    testUsers: [created.user.id, other.user.id],
  }),
);
