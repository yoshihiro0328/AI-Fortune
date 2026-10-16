import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import {
  externalAllowed,
  authActionAllowed,
  origin,
  reserveSignup,
  reserveResend,
} from "../scripts/phase6/auth-session-policy.mjs";
import {
  recoveryRedirect,
  recoveryProject,
  recoveryUser,
  recoveryCallbackAllowed,
  resetStageAllowed,
  resetApprovalValid,
  reserveReset,
  resetVerifierMatches,
} from "../scripts/phase6/auth-password-recovery.mjs";

const recipients = { a: "a@example.test", b: "b@example.test" };
const sha = (s: string) => createHash("sha256").update(s).digest("base64url");
const recover = new URL(
  origin +
    "/auth/v1/recover?redirect_to=" +
    encodeURIComponent(recoveryRedirect),
);
const recoveryBody = {
  email: recipients.b,
  code_challenge: "a".repeat(43),
  code_challenge_method: "s256",
};
const fixture = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "password-recovery-test-"));
function approve(d: string, changes = {}) {
  fs.writeFileSync(
    path.join(d, "reset-b-1.approved"),
    JSON.stringify({
      project: recoveryProject,
      user: recoveryUser,
      purpose: "password-recovery",
      count: 1,
      recipientHash: sha(recipients.b),
      expiresAt: Date.now() + 1800000,
      ...changes,
    }),
    { mode: 0o600 },
  );
}
it("requires exact project, recovery redirect and PKCE", () => {
  expect(externalAllowed(recover.href, "POST", recoveryBody)).toBe(true);
  for (const value of [
    recover.href.replace(recoveryProject, "rnvrdrfdbapfafwjbygo"),
    recover.href.replace("5198", "5188"),
    recover.href + "&redirect_to=evil",
    recover.href.replace("recovery", "other"),
  ])
    expect(externalAllowed(value, "POST", recoveryBody)).toBe(false);
  for (const change of [
    { code_challenge: "" },
    { code_challenge_method: "plain" },
    { password: "x" },
    { phone: "123" },
  ])
    expect(
      externalAllowed(recover.href, "POST", { ...recoveryBody, ...change }),
    ).toBe(false);
});
for (const stage of [
  "reset-prepared",
  "resend-b",
  "sessions",
  "a",
  "b",
  "password-b",
])
  it("blocks sending a reset in " + stage, () => {
    expect(resetStageAllowed(recover, "POST", stage, "b", undefined)).toBe(
      false,
    );
    expect(
      authActionAllowed(
        { action: "reset", email: recipients.b },
        recipients,
        stage,
      ),
    ).toBe(false);
  });
it("only B can request the single reset, without allowing signup/resend/login/logout", () => {
  expect(
    authActionAllowed(
      { action: "reset", email: recipients.b },
      recipients,
      "reset-b",
    ),
  ).toBe(true);
  expect(
    authActionAllowed(
      { action: "reset", email: recipients.a },
      recipients,
      "reset-b",
    ),
  ).toBe(false);
  expect(resetStageAllowed(recover, "POST", "reset-b", "a", undefined)).toBe(
    false,
  );
  for (const action of ["signup", "resend", "login", "logout", "update"])
    expect(
      authActionAllowed({ action, email: recipients.b }, recipients, "reset-b"),
    ).toBe(false);
});
it("no approval, wrong identity, expired or oversized approval cannot reserve email", () => {
  const d = fixture();
  try {
    expect(() =>
      reserveReset(d, "b", recipients.b, recoveryBody.code_challenge),
    ).toThrow();
    for (const changes of [
      { user: "other" },
      { project: "rnvrdrfdbapfafwjbygo" },
      { count: 2 },
      { recipientHash: sha(recipients.a) },
      { expiresAt: Date.now() - 1 },
      { expiresAt: Date.now() + 86400000 },
    ]) {
      approve(d, changes);
      expect(resetApprovalValid(d, recipients.b)).toBe(false);
      expect(() =>
        reserveReset(d, "b", recipients.b, recoveryBody.code_challenge),
      ).toThrow();
    }
    expect(fs.existsSync(path.join(d, "reset-b-1.reserved"))).toBe(false);
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
it("one durable reset reservation preserves original mail ledgers and survives a fresh caller", () => {
  const d = fixture();
  try {
    reserveSignup(d, "a");
    reserveSignup(d, "b");
    reserveResend(d, "b");
    const before = fs
      .readdirSync(d)
      .map((f) => [f, fs.readFileSync(path.join(d, f), "utf8")]);
    approve(d);
    expect(() =>
      reserveReset(d, "a", recipients.b, recoveryBody.code_challenge),
    ).toThrow();
    reserveReset(d, "b", recipients.b, recoveryBody.code_challenge);
    expect(() =>
      reserveReset(d, "b", recipients.b, recoveryBody.code_challenge),
    ).toThrow();
    for (const [f, content] of before)
      expect(fs.readFileSync(path.join(d, f), "utf8")).toBe(content);
    expect(fs.statSync(path.join(d, "reset-b-1.reserved")).mode & 0o777).toBe(
      0o600,
    );
    expect(
      fs.readFileSync(path.join(d, "reset-b-1.reserved"), "utf8"),
    ).not.toContain("@");
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
it("callback allows only code plus next=recovery during the reset stage", () => {
  const valid = new URL(recoveryRedirect + "&code=fixture");
  expect(recoveryCallbackAllowed(valid, "reset-b")).toBe(true);
  for (const stage of ["reset-prepared", "password-b", "sessions", "resend-b"])
    expect(recoveryCallbackAllowed(valid, stage)).toBe(false);
  for (const query of [
    "?code=x",
    "?next=recovery",
    "?next=recovery&code=x&code=y",
    "?next=evil&code=x",
    "?next=recovery&code=x&redirect=evil",
  ])
    expect(
      recoveryCallbackAllowed(
        new URL("http://localhost:5198/auth/callback" + query),
        "reset-b",
      ),
    ).toBe(false);
});
it("B password update cannot change email, metadata, phone, or omit strength requirements", () => {
  const url = origin + "/auth/v1/user",
    password = "Synthetic-B-only-97!";
  expect(
    externalAllowed(url, "PUT", {
      password,
      code_challenge: null,
      code_challenge_method: null,
    }),
  ).toBe(true);
  for (const body of [
    { password: "short" },
    { password, email: recipients.a },
    { password, data: { admin: true } },
    { password, phone: "123" },
    { password, code_challenge: "x" },
  ])
    expect(externalAllowed(url, "PUT", body)).toBe(false);
});
it("B-only bearer restriction protects A from password updates and global logout", () => {
  for (const [route, method] of [
    ["/auth/v1/user", "PUT"],
    ["/auth/v1/logout?scope=global", "POST"],
  ]) {
    const u = new URL(origin + route);
    expect(
      resetStageAllowed(u, method, "password-b", undefined, recoveryUser),
    ).toBe(true);
    for (const subject of [undefined, "a-user", "service_role"])
      expect(
        resetStageAllowed(u, method, "password-b", undefined, subject),
      ).toBe(false);
    for (const stage of ["sessions", "reset-b", "reset-prepared", "resend-b"])
      expect(resetStageAllowed(u, method, stage, undefined, recoveryUser)).toBe(
        false,
      );
  }
});
it("reset phase cannot refresh A or claim data", () => {
  for (const route of [
    "/auth/v1/token?grant_type=refresh_token",
    "/rest/v1/rpc/claim_anonymous_diagnoses",
    "/auth/v1/signup",
  ])
    expect(
      resetStageAllowed(
        new URL(origin + route),
        "POST",
        "reset-b",
        "b",
        recoveryUser,
      ),
    ).toBe(false);
  expect(
    resetStageAllowed(
      new URL(origin + "/auth/v1/user"),
      "GET",
      "reset-b",
      undefined,
      "a-user",
    ),
  ).toBe(false);
});
it("PKCE exchange must match the reserved reset, not an old signup or other browser verifier", () => {
  const d = fixture(),
    verifier = "b".repeat(64);
  try {
    expect(resetVerifierMatches(d, verifier)).toBe(false);
    approve(d);
    reserveReset(d, "b", recipients.b, sha(verifier));
    expect(resetVerifierMatches(d, verifier)).toBe(true);
    expect(resetVerifierMatches(d, "a".repeat(64))).toBe(false);
    expect(resetVerifierMatches(d, undefined)).toBe(false);
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
it("actual SSR SDK persists recovery PKCE across clients, exchanges, updates only password and signs out B (mock only)", async () => {
  const d = fixture(),
    jar = new Map<string, string>(),
    calls: string[] = [];
  const user = {
    id: recoveryUser,
    aud: "authenticated",
    role: "authenticated",
    email: recipients.b,
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
            reserveReset(d, "b", recipients.b, body.code_challenge);
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
                password: "Synthetic-B-only-97!",
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
        await client().auth.resetPasswordForEmail(recipients.b, {
          redirectTo: recoveryRedirect,
        })
      ).error,
    ).toBeNull();
    expect(
      (await client().auth.exchangeCodeForSession("fixture-code")).error,
    ).toBeNull();
    expect(
      (await client().auth.updateUser({ password: "Synthetic-B-only-97!" }))
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
