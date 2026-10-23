import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { browserCookies } from "./browser-cookies.mjs";
import { TARGET } from "./policy.mjs";
import { listenLoopback } from "./loopback-server.mjs";
const prefix = "plus-" + "a".repeat(32) + "--";
const other = "plus-" + "b".repeat(32) + "--";
const auth = `sb-${TARGET.ref}-auth-token`;

test("large stale namespaces are ignored but current cookies and other headers retain the 16 KiB limit", async () => {
  const scope = browserCookies(prefix);
  const server = await listenLoopback((req, res) => {
    try {
      const state = scope.install(req, res);
      res.end(
        JSON.stringify({
          header: req.headers.cookie,
          filtered: state.foreignCookieOverflowFiltered,
        }),
      );
    } catch {
      res.writeHead(403);
      res.end();
    }
  }, 0);
  try {
    const url = `http://127.0.0.1:${server.port}/account`;
    const response = await fetch(url, {
      headers: {
        cookie: `${other}${auth}=${"x".repeat(50000)}; ${prefix}yorisoi_session=current`,
      },
    });
    assert.deepEqual(await response.json(), {
      header: "yorisoi_session=current",
      filtered: true,
    });
    const current = await fetch(url, {
      headers: { cookie: `${prefix}${auth}=${"x".repeat(17000)}` },
    });
    assert.equal(current.status, 403);
    const nonCookie = await fetch(url, {
      headers: { "x-large": "x".repeat(17000) },
    });
    assert.equal(nonCookie.status, 403);
  } finally {
    await server.close();
  }
});

test("foreign localhost sessions never enter the current app, including same-project old JWTs", () => {
  const scope = browserCookies(prefix);
  const result = scope.incoming(
    `${auth}=old; sb-other-auth-token=other; yorisoi_session=old-anonymous; ${other}${auth}=prior-run; ${prefix}yorisoi_session=current`,
  );
  assert.deepEqual(result, {
    header: "yorisoi_session=current",
    foreignAuth: true,
    authenticated: false,
  });
  // A cookie value containing sb- is not an authentication cookie.
  assert.equal(
    scope.incoming(`${prefix}yorisoi_session=sb-marker`).authenticated,
    false,
  );
});
test("current JWT chunks still trigger the entry guard; ambiguous cookies fail closed", () => {
  const scope = browserCookies(prefix);
  const h = `${prefix}${auth}.0=chunk0; ${prefix}${auth}.1=chunk1`;
  assert.equal(scope.incoming(h).authenticated, true);
  assert.equal(scope.incoming(h).header, `${auth}.0=chunk0; ${auth}.1=chunk1`);
  assert.equal(
    scope.incoming(`${prefix}${auth}-code-verifier=pkce`).authenticated,
    false,
  );
  assert.throws(
    () => scope.incoming(`${prefix}${auth}=one; ${prefix}${auth}=two`),
    /AMBIGUOUS/,
  );
  assert.throws(
    () => scope.incoming(`${prefix}sb-outside-auth-token=wrong-project`),
    /AMBIGUOUS/,
  );
  assert.throws(() => browserCookies(""), /NAMESPACE/);
});
test("SSR writes, chunk deletions and recovery cookies retain attributes under only the current namespace", () => {
  const scope = browserCookies(prefix);
  const values = [
    `${auth}.0=x; Path=/; HttpOnly; SameSite=Lax`,
    `${auth}.1=; Max-Age=0; Path=/`,
    "yorisoi_recovery=x; Path=/; HttpOnly",
  ];
  assert.deepEqual(
    scope.outgoing(values),
    values.map((x) => prefix + x),
  );
  assert.throws(() => scope.outgoing("unrelated=value"), /UNSCOPED/);
});
test("real HTTP boundary maps incoming and outgoing cookies without deleting unrelated browser state", async () => {
  const scope = browserCookies(prefix);
  const server = http.createServer((req, res) => {
    const state = scope.install(req, res);
    res.setHeader("Set-Cookie", [
      "yorisoi_session=current; HttpOnly; SameSite=Lax; Path=/",
      `${auth}.0=fixture; HttpOnly; Path=/`,
    ]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        header: req.headers.cookie,
        authenticated: state.authenticated,
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
      headers: { cookie: `${auth}=old; ${prefix}yorisoi_session=current` },
    });
    assert.deepEqual(await response.json(), {
      header: "yorisoi_session=current",
      authenticated: false,
    });
    assert(response.headers.getSetCookie().every((x) => x.startsWith(prefix)));
    assert(
      response.headers.getSetCookie().every((x) => !x.includes("Max-Age=0")),
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Next appends multiple SSR cookie chunks without rejecting or double-prefixing the first", async () => {
  const { NodeNextResponse } =
    await import("next/dist/server/base-http/node.js");
  const scope = browserCookies(prefix);
  const req = new http.IncomingMessage({});
  req.headers = {};
  const res = new http.ServerResponse(req);
  scope.install(req, res);
  const nextResponse = new NodeNextResponse(res);
  nextResponse.appendHeader(
    "Set-Cookie",
    `${auth}.0=synthetic-first; Path=/; HttpOnly`,
  );
  nextResponse.appendHeader(
    "Set-Cookie",
    `${auth}.1=synthetic-second; Path=/; HttpOnly`,
  );
  assert.deepEqual(res.getHeader("Set-Cookie"), [
    `${prefix}${auth}.0=synthetic-first; Path=/; HttpOnly`,
    `${prefix}${auth}.1=synthetic-second; Path=/; HttpOnly`,
  ]);
  assert.throws(
    () => scope.outgoing(`${other}${auth}=outside; Path=/`),
    /UNSCOPED/,
  );
});
