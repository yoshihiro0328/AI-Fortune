import { it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import {
  externalAllowed,
  recoveryExternalAllowed,
  authActionAllowed,
  reserveSignup,
  reserveResend,
  pkceCookiePresent,
  origin,
} from "../scripts/phase6/auth-session-policy.mjs";
const recipients = { a: "a@example.test", b: "b@example.test" };
const url =
  origin +
  "/auth/v1/resend?redirect_to=" +
  encodeURIComponent("http://localhost:5198/auth/callback");
const body = {
  email: recipients.b,
  type: "signup",
  code_challenge_method: "s256",
  code_challenge: "a".repeat(43),
};
it("permits only shaped PKCE resend", () =>
  expect(externalAllowed(url, "POST", body)).toBe(true));
for (const change of [
  { type: "recovery" },
  { code_challenge_method: "plain" },
  { code_challenge: "" },
  { phone: "123" },
  { password: "x" },
])
  it("rejects unsafe resend shape " + JSON.stringify(change), () =>
    expect(externalAllowed(url, "POST", { ...body, ...change })).toBe(false),
  );
it("denies resend wrong callback and old project", () => {
  expect(externalAllowed(url.replace("5198", "5188"), "POST", body)).toBe(
    false,
  );
  expect(
    externalAllowed(
      url.replace("ukdzggjfkcwjssjmnqim", "rnvrdrfdbapfafwjbygo"),
      "POST",
      body,
    ),
  ).toBe(false);
});
it("requires approved stage and B for egress", () => {
  expect(recoveryExternalAllowed(url, "POST", "resend-b", "b")).toBe(true);
  for (const stage of ["a", "b", "sessions"])
    expect(recoveryExternalAllowed(url, "POST", stage, "b")).toBe(false);
  expect(recoveryExternalAllowed(url, "POST", "resend-b", "a")).toBe(false);
});
for (const action of ["signup", "login", "logout", "reset"])
  it("blocks " + action + " during recovery", () =>
    expect(
      authActionAllowed(
        { action, email: recipients.b },
        recipients,
        "resend-b",
      ),
    ).toBe(false),
  );
it("permits B resend only at ingress", () => {
  expect(
    authActionAllowed(
      { action: "resend", email: recipients.b },
      recipients,
      "resend-b",
    ),
  ).toBe(true);
  expect(
    authActionAllowed(
      { action: "resend", email: recipients.a },
      recipients,
      "resend-b",
    ),
  ).toBe(false);
});
it("blocks outbound signup password refresh logout before B confirmation", () => {
  for (const route of [
    "/auth/v1/signup",
    "/auth/v1/token?grant_type=password",
    "/auth/v1/token?grant_type=refresh_token",
    "/auth/v1/logout?scope=local",
  ])
    expect(
      recoveryExternalAllowed(origin + route, "POST", "resend-b", "b"),
    ).toBe(false);
});
it("keeps original reservations and refuses duplicate resend across callers", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "resend-test-"));
  try {
    reserveSignup(d, "a");
    reserveSignup(d, "b");
    const before = fs.readFileSync(path.join(d, "signup-b.reserved"), "utf8");
    reserveResend(d, "b");
    expect(() => reserveResend(d, "b")).toThrow();
    expect(() => reserveResend(d, "a")).toThrow();
    expect(fs.readFileSync(path.join(d, "signup-b.reserved"), "utf8")).toBe(
      before,
    );
    expect(fs.statSync(path.join(d, "resend-b-1.reserved")).mode & 0o777).toBe(
      0o600,
    );
  } finally {
    fs.rmSync(d, { recursive: true });
  }
});
it("cookie presence does not accept other project or empty cookie", () => {
  expect(
    pkceCookiePresent([
      { name: "sb-other-auth-token-code-verifier", value: "x" },
    ]),
  ).toBe(false);
  expect(
    pkceCookiePresent([
      { name: "sb-ukdzggjfkcwjssjmnqim-auth-token-code-verifier", value: "" },
    ]),
  ).toBe(false);
});
it("actual installed SSR SDK resend persists a verifier matching outgoing challenge (mock only)", async () => {
  const jar = new Map<string, string>();
  let calls = 0;
  const client = createServerClient(origin, "anon-fixture", {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => {
        for (const c of cs) jar.set(c.name, c.value);
      },
    },
    global: {
      fetch: async (input, init) => {
        calls++;
        const sent = JSON.parse(String(init?.body));
        expect(String(input)).toBe(url);
        expect(externalAllowed(String(input), "POST", sent)).toBe(true);
        const encoded = [...jar].find(
          ([name]) =>
            name.endsWith("-code-verifier") && !name.includes("-flows-"),
        )?.[1];
        expect(encoded).toBeTruthy();
        const verifier = JSON.parse(
          Buffer.from(encoded!.slice("base64-".length), "base64url").toString(),
        );
        expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
          sent.code_challenge,
        );
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  const result = await client.auth.resend({
    type: "signup",
    email: recipients.b,
    options: { emailRedirectTo: "http://localhost:5198/auth/callback" },
  });
  expect(result.error).toBeNull();
  expect(calls).toBe(1);
  expect(
    pkceCookiePresent([...jar].map(([name, value]) => ({ name, value }))),
  ).toBe(true);
});
