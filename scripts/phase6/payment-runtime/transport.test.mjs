// The transport itself uses a stubbed fetch here; no sockets or real credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { providerTransport } from "./broker.mjs";
import { TARGET } from "./policy.mjs";
const secrets = {
  stripe: "rk_test_synthetic",
  anon: "synthetic-anon",
  service: "synthetic-service",
};
for (const [kind, url, headers, expected] of [
  [
    "stripe",
    TARGET.stripe + "/v1/account",
    {
      authorization: "Bearer rk_test_local_proxy",
      "stripe-account": "forbidden",
      "x-unknown": "discard",
    },
    "Bearer rk_test_synthetic",
  ],
  [
    "DB",
    TARGET.supabase + "/rest/v1/payments",
    {
      apikey: "local-service",
      authorization: "Bearer local-service",
      "content-profile": "public",
    },
    "Bearer synthetic-service",
  ],
  [
    "user JWT",
    TARGET.supabase + "/auth/v1/user",
    { apikey: "local-anon", authorization: "Bearer synthetic-user-token" },
    "Bearer synthetic-user-token",
  ],
])
  test(
    "transport maps " +
      kind +
      " credentials in memory, verifies normal TLS and forbids redirects",
    async () => {
      const original = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        assert.equal(input, url);
        assert.equal(init.headers.get("authorization"), expected);
        assert.equal(init.headers.get("stripe-account"), null);
        assert.equal(init.headers.get("x-unknown"), null);
        if (kind !== "stripe")
          assert.equal(
            init.headers.get("apikey"),
            kind === "DB" ? secrets.service : secrets.anon,
          );
        assert.equal(init.redirect, "error");
        assert(init.signal);
        assert.equal(init.dispatcher, undefined);
        return new Response("{}", { status: 200 });
      };
      try {
        assert.equal(
          (await providerTransport(secrets)({ url, method: "GET", headers }))
            .status,
          200,
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = original;
      }
    },
  );
test("transport refuses a different origin even when called without the policy layer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("MUST_NOT_CALL_FETCH");
  };
  try {
    await assert.rejects(
      providerTransport(secrets)({
        url: "https://rnvrdrfdbapfafwjbygo.supabase.co/rest/v1/payments",
        method: "GET",
        headers: {},
      }),
      /POLICY_DENIED/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
