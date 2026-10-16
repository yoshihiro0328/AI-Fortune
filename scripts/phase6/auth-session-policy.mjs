/** STEP 9 only. Does not replace application authorization or CSRF. */
import fs from "node:fs";
import path from "node:path";
import { origin, allowedExternal as readOnly } from "./local-auth-policy.mjs";
import {
  recoveryRequestShape,
  resetStages,
} from "./auth-password-recovery.mjs";
export { origin };
export function externalAllowed(value, method = "GET", body = {}) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.origin !== origin || u.username || u.password || u.hash) return false;
  if (recoveryRequestShape(u, method, body)) return true;
  if (readOnly(value, method)) return true;
  if (method === "GET" && u.pathname === "/rest/v1/profiles") return true;
  if (method !== "POST") return false;
  if (u.pathname === "/auth/v1/resend")
    return (
      u.searchParams.get("redirect_to") ===
        "http://localhost:5198/auth/callback" &&
      [...u.searchParams.keys()].every((k) => k === "redirect_to") &&
      body.type === "signup" &&
      typeof body.email === "string" &&
      body.code_challenge_method === "s256" &&
      /^[A-Za-z0-9_-]{43}$/.test(body.code_challenge ?? "") &&
      !body.password &&
      !body.phone
    );
  if (u.pathname === "/auth/v1/signup")
    return (
      u.searchParams.get("redirect_to") ===
        "http://localhost:5198/auth/callback" &&
      [...u.searchParams.keys()].every((k) => k === "redirect_to") &&
      typeof body.email === "string" &&
      typeof body.password === "string" &&
      body.code_challenge_method === "s256" &&
      /^[A-Za-z0-9_-]{43}$/.test(body.code_challenge ?? "") &&
      !body.phone
    );
  if (u.pathname === "/auth/v1/token")
    return (
      [...u.searchParams.keys()].every((k) => k === "grant_type") &&
      ["password", "pkce", "refresh_token"].includes(
        u.searchParams.get("grant_type"),
      )
    );
  if (u.pathname === "/auth/v1/logout")
    return (
      ["local", "global"].includes(u.searchParams.get("scope")) &&
      [...u.searchParams.keys()].every((k) => k === "scope")
    );
  if (u.search) return false;
  if (u.pathname === "/rest/v1/rpc/consume_limit")
    return (
      Object.keys(body).sort().join(",") === "p_key,p_limit,p_seconds" &&
      /^auth(?:-signup|-email)?:[a-z0-9:-]+$/.test(body.p_key ?? "") &&
      Number.isInteger(body.p_limit) &&
      body.p_limit >= 1 &&
      body.p_limit <= 40 &&
      [3600, 86400].includes(body.p_seconds)
    );
  if (u.pathname === "/rest/v1/rpc/claim_anonymous_diagnoses")
    return (
      Object.keys(body).sort().join(",") === "p_session,p_user" &&
      /^[0-9a-f-]{36}$/.test(body.p_user ?? "") &&
      (body.p_session === null || /^[0-9a-f]{64}$/.test(body.p_session ?? ""))
    );
  return false;
}
export function incomingAllowed(pathname, method, host) {
  if (!["localhost:5198", "127.0.0.1:5198"].includes(host)) return false;
  if (["/api/billing", "/api/consultations"].includes(pathname)) return false;
  if (method === "POST") return pathname === "/api/auth";
  return (
    ["GET", "HEAD"].includes(method) &&
    (!pathname.startsWith("/auth/") || pathname === "/auth/callback") &&
    !/^\/(api\/cron|_next\/image)(\/|$)/.test(pathname)
  );
}
export function authActionAllowed(body, recipients, stage) {
  if (resetStages.has(stage))
    return (
      (stage === "reset-b" &&
        body.action === "reset" &&
        body.email?.trim().toLowerCase() === recipients.b) ||
      (stage === "password-b" && body.action === "update")
    );
  if (stage === "resend-b")
    return (
      body.action === "resend" &&
      body.email?.trim().toLowerCase() === recipients.b
    );
  if (body.action === "logout") return true;
  const label = Object.entries(recipients).find(
    ([, email]) => email === body.email?.trim().toLowerCase(),
  )?.[0];
  return (
    !!label &&
    ["signup", "login"].includes(body.action) &&
    (body.action !== "signup" || label === stage)
  );
}
export function recoveryExternalAllowed(url, method, stage, label) {
  const u = new URL(url);
  if (u.pathname === "/auth/v1/resend")
    return stage === "resend-b" && label === "b";
  if (stage !== "resend-b") return true;
  if (method === "GET")
    return [
      "/auth/v1/user",
      "/rest/v1/diagnoses",
      "/rest/v1/service_settings",
    ].includes(u.pathname);
  return (
    (u.pathname === "/auth/v1/token" &&
      u.searchParams.get("grant_type") === "pkce") ||
    [
      "/rest/v1/rpc/consume_limit",
      "/rest/v1/rpc/claim_anonymous_diagnoses",
    ].includes(u.pathname)
  );
}
export function reserveResend(dir, label) {
  if (label !== "b") throw new Error("Unapproved resend recipient");
  const fd = fs.openSync(path.join(dir, "resend-b-1.reserved"), "wx", 0o600);
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({
        label,
        at: new Date().toISOString(),
        approval: "STEP9-B-resend-1",
      }),
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
export function pkceCookiePresent(cookies) {
  const prefix = "sb-ukdzggjfkcwjssjmnqim-auth-token";
  return cookies.some(
    ({ name, value }) =>
      name.startsWith(prefix) && name.includes("-code-verifier") && !!value,
  );
}
// Reserve BEFORE forwarding; O_EXCL prevents repeats/concurrency across processes/restarts.
// Failed and unknown attempts remain consumed. Never auto-delete this ledger.
export function reserveSignup(dir, label) {
  if (!["a", "b"].includes(label)) throw new Error("Unapproved recipient");
  const fd = fs.openSync(
    path.join(dir, "signup-" + label + ".reserved"),
    "wx",
    0o600,
  );
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ label, at: new Date().toISOString() }),
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
export async function boundedBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 30000) throw new Error("Body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// Profile RLS checks must never accept an administrative bearer, even with anon apikey.
export function profileCredentialsAllowed(apiKey, bearer, keys) {
  return apiKey === keys[0] && !!bearer && !keys.includes(bearer);
}
