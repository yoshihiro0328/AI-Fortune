import { check, TARGET } from "./policy.mjs";
import { minimal } from "./minimal-profile.mjs";

// Public local-harness instruction, never a Supabase password or bearer token.
export const WORK_LOGIN = "UsePreparedTestAccount123!";

// Behind the existing identity/request policy. Authenticate with the generated
// password through the real Auth endpoint; never fabricate a session or JWT.
export function workLogin(m, passwords) {
  check(minimal(m), "MINIMAL_LOGIN_REQUIRED");
  const pending = new Map(
    ["c", "d"].map((role) => {
      check(
        typeof passwords[role] === "string" && passwords[role].length >= 12,
      );
      return [m[role].email, passwords[role]];
    }),
  );
  check(pending.size === 2, "DISTINCT_TEST_USERS_REQUIRED");
  return {
    body(r) {
      const u = new URL(r.url);
      if (u.origin !== TARGET.supabase || u.pathname !== "/auth/v1/token")
        return r.body;
      if (u.searchParams.get("grant_type") === "refresh_token") return r.body;
      check(
        r.method === "POST" && u.search === "?grant_type=password",
        "TEST_LOGIN_REQUEST_DENIED",
      );
      const b = JSON.parse(r.body);
      check(
        b.password === WORK_LOGIN && pending.has(b.email),
        "TEST_LOGIN_IDENTITY_DENIED",
      );
      const password = pending.get(b.email);
      // Consume before transmission: unknown results cannot be retried.
      pending.delete(b.email);
      return JSON.stringify({ ...b, password });
    },
    close() {
      pending.clear();
    },
  };
}
