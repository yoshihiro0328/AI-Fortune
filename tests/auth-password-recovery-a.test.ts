import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import {
  aRecovery,
  recoveryFlow,
  resetStageAllowed,
  recoveryCallbackAllowed,
} from "../scripts/phase6/auth-recovery-flows.mjs";
import {
  bRecovery,
  recoveryProject,
  recoveryRedirect,
} from "../scripts/phase6/auth-password-recovery.mjs";
import {
  origin,
  externalAllowed,
  authActionAllowed,
} from "../scripts/phase6/auth-session-policy.mjs";
const recipients = { a: "a@example.test", b: "b@example.test" };
const sha = (s: string) => createHash("sha256").update(s).digest("base64url");
const fixture = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "a-recovery-test-"));
const recoveryUser = aRecovery.user;
const reserveReset = aRecovery.reserveReset;
const resetVerifierMatches = aRecovery.resetVerifierMatches;
function approve(d: string, changes = {}) {
  fs.writeFileSync(
    path.join(d, aRecovery.approvalFile),
    JSON.stringify({
      project: recoveryProject,
      user: recoveryUser,
      purpose: "password-recovery",
      count: 1,
      recipientHash: sha(recipients.a),
      expiresAt: Date.now() + 1800000,
      ...changes,
    }),
    { mode: 0o600 },
  );
}
const recover = new URL(
  origin +
    "/auth/v1/recover?redirect_to=" +
    encodeURIComponent(recoveryRedirect),
);
it("A prepared stage blocks all auth writes even when B has prior approval", () => {
  for (const action of [
    "signup",
    "login",
    "resend",
    "reset",
    "update",
    "logout",
  ])
    expect(
      authActionAllowed(
        { action, email: recipients.a },
        recipients,
        "reset-a-prepared",
      ),
    ).toBe(false);
  for (const route of [
    "/auth/v1/recover",
    "/auth/v1/token?grant_type=pkce",
    "/auth/v1/logout?scope=global",
    "/rest/v1/rpc/claim_anonymous_diagnoses",
  ])
    expect(
      resetStageAllowed(
        new URL(origin + route),
        "POST",
        "reset-a-prepared",
        "a",
        recoveryUser,
      ),
    ).toBe(false);
});
it("only A reset stage accepts A, not B or signup, resend or login", () => {
  expect(
    authActionAllowed(
      { action: "reset", email: recipients.a },
      recipients,
      "reset-a",
    ),
  ).toBe(true);
  expect(
    authActionAllowed(
      { action: "reset", email: recipients.b },
      recipients,
      "reset-a",
    ),
  ).toBe(false);
  expect(resetStageAllowed(recover, "POST", "reset-a", "a", undefined)).toBe(
    true,
  );
  expect(resetStageAllowed(recover, "POST", "reset-a", "b", undefined)).toBe(
    false,
  );
  for (const action of ["signup", "resend", "login", "logout", "update"])
    expect(
      authActionAllowed({ action, email: recipients.a }, recipients, "reset-a"),
    ).toBe(false);
});
it("A recovery cannot borrow B approval or reserve without final approval", () => {
  const d = fixture();
  try {
    fs.writeFileSync(
      path.join(d, bRecovery.approvalFile),
      JSON.stringify({
        project: recoveryProject,
        user: bRecovery.user,
        count: 1,
        recipientHash: sha(recipients.b),
        expiresAt: Date.now() + 1800000,
      }),
    );
    expect(() => reserveReset(d, "a", recipients.a, "a".repeat(43))).toThrow();
    expect(fs.existsSync(path.join(d, aRecovery.reservationFile))).toBe(false);
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
it("A approval rejects wrong project, user, recipient, budget, or expiry", () => {
  const d = fixture();
  try {
    for (const change of [
      { user: bRecovery.user },
      { project: "rnvrdrfdbapfafwjbygo" },
      { recipientHash: sha(recipients.b) },
      { count: 2 },
      { expiresAt: Date.now() - 1 },
      { expiresAt: Date.now() + 86400000 },
    ]) {
      approve(d, change);
      expect(() =>
        reserveReset(d, "a", recipients.a, "a".repeat(43)),
      ).toThrow();
    }
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
it("A durable one-shot reservation preserves every existing mail ledger", () => {
  const d = fixture();
  try {
    const old = [
      "signup-a.reserved",
      "signup-b.reserved",
      "resend-b-1.reserved",
      bRecovery.reservationFile,
    ];
    for (const f of old) fs.writeFileSync(path.join(d, f), "immutable-fixture");
    approve(d);
    reserveReset(d, "a", recipients.a, "a".repeat(43));
    expect(() => reserveReset(d, "a", recipients.a, "a".repeat(43))).toThrow();
    expect(() => reserveReset(d, "b", recipients.a, "a".repeat(43))).toThrow();
    for (const f of old)
      expect(fs.readFileSync(path.join(d, f), "utf8")).toBe(
        "immutable-fixture",
      );
    expect(
      fs.statSync(path.join(d, aRecovery.reservationFile)).mode & 0o777,
    ).toBe(0o600);
    expect(
      fs.readFileSync(path.join(d, aRecovery.reservationFile), "utf8"),
    ).not.toContain("@");
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
it("A PKCE accepts only its own reserved verifier, never B's", () => {
  const d = fixture();
  try {
    approve(d);
    reserveReset(d, "a", recipients.a, sha("a".repeat(64)));
    expect(resetVerifierMatches(d, "a".repeat(64))).toBe(true);
    expect(resetVerifierMatches(d, "b".repeat(64))).toBe(false);
    expect(bRecovery.resetVerifierMatches(d, "a".repeat(64))).toBe(false);
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
it("A update and global logout reject B, service role and missing identity", () => {
  for (const [route, method] of [
    ["/auth/v1/user", "PUT"],
    ["/auth/v1/logout?scope=global", "POST"],
  ]) {
    const u = new URL(origin + route);
    expect(
      resetStageAllowed(u, method, "password-a", undefined, recoveryUser),
    ).toBe(true);
    for (const user of [bRecovery.user, undefined, "service_role"])
      expect(resetStageAllowed(u, method, "password-a", undefined, user)).toBe(
        false,
      );
    expect(
      resetStageAllowed(u, method, "password-b", undefined, recoveryUser),
    ).toBe(false);
  }
});
it("A callback requires exactly recovery next and a single code in the send stage", () => {
  const u = new URL(recoveryRedirect + "&code=fixture");
  expect(recoveryCallbackAllowed(u, "reset-a")).toBe(true);
  for (const stage of ["reset-a-prepared", "password-a", "sessions"])
    expect(recoveryCallbackAllowed(u, stage)).toBe(false);
  expect(
    recoveryCallbackAllowed(new URL(u.href + "&code=other"), "reset-a"),
  ).toBe(false);
});
it("A reset cannot refresh B, claim data, or permit unrelated reset stages", () => {
  expect(recoveryFlow("reset-a")).toBe(aRecovery);
  expect(recoveryFlow("reset-b")).toBe(bRecovery);
  expect(recoveryFlow("reset-c")).toBeNull();
  expect(
    resetStageAllowed(
      new URL(origin + "/auth/v1/user"),
      "GET",
      "reset-a",
      undefined,
      bRecovery.user,
    ),
  ).toBe(false);
  for (const route of [
    "/auth/v1/token?grant_type=refresh_token",
    "/rest/v1/rpc/claim_anonymous_diagnoses",
    "/auth/v1/signup",
  ])
    expect(
      resetStageAllowed(
        new URL(origin + route),
        "POST",
        "reset-a",
        "a",
        recoveryUser,
      ),
    ).toBe(false);
});
it("actual SSR SDK persists recovery PKCE across clients, exchanges, updates only password and signs out A (mock only)", async () => {
  const d = fixture(),
    jar = new Map<string, string>(),
    calls: string[] = [];
  const user = {
    id: recoveryUser,
    aud: "authenticated",
    role: "authenticated",
    email: recipients.a,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const jwt = [
    { alg: "HS256", typ: "JWT" },
    {
      sub: recoveryUser,
      iss: origin + "/auth/v1",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "fixture-signature",
  ]
    .map((x) =>
      Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString(
        "base64url",
      ),
    )
    .join(".");
  const client = () =>
    createServerClient(origin, "anon-fixture", {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cs) => {
          for (const c of cs) jar.set(c.name, c.value);
        },
      },
      global: {
        fetch: async (input, init) => {
          const u = new URL(String(input)),
            method = init?.method ?? "GET",
            body = init?.body ? JSON.parse(String(init.body)) : {};
          calls.push(method + " " + u.pathname);
          expect(externalAllowed(u.href, method, body)).toBe(true);
          let result: unknown = {};
          if (u.pathname === "/auth/v1/recover") {
            const encoded = [...jar].find(
              ([name]) =>
                name.endsWith("-code-verifier") && !name.includes("-flows-"),
            )?.[1];
            const stored = JSON.parse(
              Buffer.from(encoded!.slice(7), "base64url").toString(),
            );
            const [verifier, marker] = stored.split("/");
            expect(marker).toBe("recovery");
            expect(sha(verifier)).toBe(body.code_challenge);
            reserveReset(d, "a", recipients.a, body.code_challenge);
          } else if (u.pathname === "/auth/v1/token") {
            expect(resetVerifierMatches(d, body.code_verifier)).toBe(true);
            result = {
              access_token: jwt,
              refresh_token: "fixture-refresh",
              expires_in: 3600,
              token_type: "bearer",
              user,
            };
          } else if (u.pathname === "/auth/v1/user") {
            if (method === "PUT")
              expect(body).toEqual({
                password: "Synthetic-A-only-97!",
                code_challenge: null,
                code_challenge_method: null,
              });
            result = user;
          } else if (u.pathname === "/auth/v1/logout")
            expect(u.searchParams.get("scope")).toBe("global");
          else throw new Error("Unexpected mock operation");
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    });
  try {
    approve(d);
    expect(
      (
        await client().auth.resetPasswordForEmail(recipients.a, {
          redirectTo: recoveryRedirect,
        })
      ).error,
    ).toBeNull();
    expect(
      (await client().auth.exchangeCodeForSession("fixture-code")).error,
    ).toBeNull();
    expect(
      (await client().auth.updateUser({ password: "Synthetic-A-only-97!" }))
        .error,
    ).toBeNull();
    expect((await client().auth.signOut({ scope: "global" })).error).toBeNull();
    expect(calls.filter((c) => c === "POST /auth/v1/recover")).toHaveLength(1);
    expect(calls).toContain("PUT /auth/v1/user");
    expect(calls).toContain("POST /auth/v1/logout");
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
