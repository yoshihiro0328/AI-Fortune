import { it, expect, vi, afterEach } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { origin } from "../scripts/phase6/auth-session-policy.mjs";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
async function intercept() {
  const forward = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", forward);
  vi.stubEnv("PHASE6_PROXY_TOKEN", "fixture-proxy");
  await import("../scripts/phase6/auth-session-fetch.mjs");
  return forward;
}
it("installed SDK bodyless logout passes the actual transport hook to the scoped proxy", async () => {
  const forward = await intercept();
  const client = createServerClient(origin, "anon-fixture", {
    cookies: { getAll: () => [], setAll: () => {} },
  });
  const result = await client.auth.admin.signOut("synthetic-user-jwt", "local");
  expect(result.error).toBeNull();
  expect(forward).toHaveBeenCalledTimes(1);
  expect(forward.mock.calls[0][0]).toBe(
    "http://127.0.0.1:5199/auth/v1/logout?scope=local",
  );
});
it("B global logout still goes through proxy stage and subject checks", async () => {
  const forward = await intercept();
  const client = createServerClient(origin, "anon-fixture", {
    cookies: { getAll: () => [], setAll: () => {} },
  });
  expect(
    (await client.auth.admin.signOut("synthetic-user-jwt", "global")).error,
  ).toBeNull();
  expect(forward.mock.calls[0][0]).toBe(
    "http://127.0.0.1:5199/auth/v1/logout?scope=global",
  );
});
it("empty body does not authorize signup, recover or arbitrary external URLs", async () => {
  const forward = await intercept();
  for (const url of [
    origin + "/auth/v1/signup",
    origin + "/auth/v1/recover",
    "https://api.stripe.com/logout",
    "https://rnvrdrfdbapfafwjbygo.supabase.co/auth/v1/logout?scope=local",
  ])
    await expect(fetch(url, { method: "POST" })).rejects.toThrow(
      "STEP9 outbound blocked",
    );
  expect(forward).not.toHaveBeenCalled();
});
it("invalid JSON remains blocked before network forwarding", async () => {
  const forward = await intercept();
  await expect(
    fetch(origin + "/auth/v1/logout?scope=local", {
      method: "POST",
      body: "bad-json",
    }),
  ).rejects.toThrow("STEP9 invalid body");
  expect(forward).not.toHaveBeenCalled();
});
