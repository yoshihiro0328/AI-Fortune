import { createHmac } from "node:crypto";
import { validatePlan, tables } from "./step10-fixtures.mjs";
export const origin = "https://ukdzggjfkcwjssjmnqim.supabase.co";
export const appOrigin = "http://localhost:5208";
export function context(runtime, plan, anonymous) {
  validatePlan(plan);
  if (
    runtime.NEXT_PUBLIC_SUPABASE_URL !== origin ||
    runtime.NEXT_PUBLIC_APP_URL !== appOrigin ||
    runtime.STRIPE_MODE !== "sandbox" ||
    runtime.STRIPE_ACCOUNT_ID !== "acct_1UQlQdI73kTcvXz8"
  )
    throw Error("Target mismatch");
  for (const k of [
    "TRIAL_ENABLED",
    "TRIAL_RETENTION_VERIFIED",
    "TRIAL_BUDGET_VERIFIED",
    "STRIPE_LIVE_CHECKOUT_ENABLED",
    "PREVIEW_DEMO_ENABLED",
    "PUBLIC_INDEXING_ENABLED",
  ])
    if (runtime[k] !== "false") throw Error("Unsafe flags");
  if (
    Object.entries(runtime).some(
      ([k, v]) => v && /OPENAI|WEBHOOK|STRIPE.*(SECRET|KEY)|VERCEL/.test(k),
    )
  )
    throw Error("Forbidden credential");
  for (const [k, role] of [
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"],
    ["SUPABASE_SERVICE_ROLE_KEY", "service_role"],
  ]) {
    const p = JSON.parse(Buffer.from(runtime[k].split(".")[1], "base64url"));
    if (p.ref !== plan.project || p.role !== role) throw Error("Wrong key");
  }
  const hash = (v) =>
    createHmac("sha256", runtime.SESSION_SECRET).update(v).digest("hex");
  if (
    anonymous.length !== 3 ||
    new Set(anonymous).size !== 3 ||
    anonymous.slice(0, 2).some((v, i) => hash(v) !== plan.hashes[i])
  )
    throw Error("Session mismatch");
  return {
    plan,
    runtime,
    hashes: [...plan.hashes, hash(anonymous[2])],
    ipKey: "auth:ip:" + hash("local"),
  };
}
export function roleOf(apikey, bearer, c) {
  if (apikey === c.runtime.SUPABASE_SERVICE_ROLE_KEY && bearer === apikey)
    return "service";
  if (apikey !== c.runtime.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  if (bearer === apikey) return "anon";
  if (bearer === "invalid.jwt.value") return "invalid";
  try {
    const p = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url"));
    if (
      p.iss === origin + "/auth/v1" &&
      p.role === "authenticated" &&
      c.plan.users.includes(p.sub)
    )
      return "user";
  } catch {}
  return null;
}
const readTables = new Set([
  ...tables,
  "subject_diagnoses",
  "subscriptions",
  "billing_customers",
  "payment_environment",
  "service_settings",
]);
export function externalAllowed(url, method, b, c, role, stage) {
  const u = new URL(url);
  if (u.origin !== origin || u.username || u.password || u.hash || !role)
    return false;
  if (
    method === "GET" &&
    u.pathname === "/auth/v1/user" &&
    !u.search &&
    ["user", "invalid"].includes(role)
  )
    return true;
  if (
    ["GET", "HEAD"].includes(method) &&
    readTables.has(u.pathname.slice("/rest/v1/".length)) &&
    u.pathname.startsWith("/rest/v1/")
  ) {
    return [...u.searchParams.keys()].every((k) =>
      [
        "select",
        "id",
        "user_id",
        "subject_id",
        "thread_id",
        "diagnosis_id",
        "anonymous_session_id",
        "title",
        "nickname",
        "user_text",
        "order",
        "limit",
        "offset",
      ].includes(k),
    );
  }
  if (stage !== "run") return false;
  if (
    method === "PATCH" &&
    ["user"].includes(role) &&
    tables.slice(0, 4).some((t) => u.pathname === "/rest/v1/" + t)
  ) {
    const t = u.pathname.split("/").at(-1);
    return (
      [...u.searchParams.keys()].join() === "id" &&
      c.plan.rows[t].includes(u.searchParams.get("id")?.replace(/^eq\./, "")) &&
      Object.keys(b).join() === "user_id" &&
      c.plan.users.includes(b.user_id)
    );
  }
  if (method !== "POST" || u.search) return false;
  if (u.pathname === "/rest/v1/rpc/claim_anonymous_diagnoses")
    return (
      ["anon", "user", "service"].includes(role) &&
      Object.keys(b).sort().join() === "p_session,p_user" &&
      c.plan.users.includes(b.p_user) &&
      c.hashes.includes(b.p_session)
    );
  if (role !== "service") return false;
  if (u.pathname === "/rest/v1/rpc/consultation_entitlement")
    return (
      Object.keys(b).join() === "p_user" && c.plan.users.includes(b.p_user)
    );
  if (u.pathname === "/rest/v1/rpc/consume_limit")
    return (
      Object.keys(b).sort().join() === "p_key,p_limit,p_seconds" &&
      b.p_seconds === 3600 &&
      ((b.p_key === c.ipKey && b.p_limit === 40) ||
        (c.hashes.some((h) => b.p_key === "auth:claim:" + h) &&
          b.p_limit === 5))
    );
  return false;
}
export function incomingAllowed(path, method, body) {
  return (
    (method === "GET" &&
      ["/api/consultations", "/api/diagnoses"].includes(path)) ||
    (method === "POST" &&
      path === "/api/auth" &&
      body?.action === "claim" &&
      Object.keys(body).every((k) =>
        ["action", "p_user", "p_session"].includes(k),
      ))
  );
}
