import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { listenLoopback } from "./loopback-server.mjs";

test("same server route on both localhost families, with no wildcard binding; closes both", async () => {
  const server = await listenLoopback((req, res) => res.end("local-only"), 0);
  assert.deepEqual(
    server.addresses.map((a) => a.address),
    ["127.0.0.1", "::1"],
  );
  for (const host of ["127.0.0.1", "[::1]"]) {
    const response = await fetch(`http://${host}:${server.port}/account`);
    assert.equal(await response.text(), "local-only");
  }
  await server.close();
  for (const host of ["127.0.0.1", "[::1]"])
    await assert.rejects(fetch(`http://${host}:${server.port}/account`));
});

test("second-family startup failure releases the first listener", async () => {
  const blocker = http.createServer();
  await new Promise((resolve) =>
    blocker.listen({ host: "::1", port: 0, ipv6Only: true }, resolve),
  );
  const port = blocker.address().port;
  try {
    await assert.rejects(
      listenLoopback(() => {}, port),
      { code: "EADDRINUSE" },
    );
    await assert.rejects(fetch(`http://127.0.0.1:${port}`));
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("parser diagnostics contain no request headers or secret values", async () => {
  const events = [];
  const server = await listenLoopback(
    () => assert.fail("invalid headers reached app"),
    0,
    (e) => events.push(e),
  );
  try {
    await new Promise((resolve, reject) => {
      const socket = net.connect(server.port, "127.0.0.1", () => {
        socket.write(
          "GET / HTTP/1.1\r\nHost: localhost\r\nCookie: secret-fixture=" +
            "x".repeat(140000) +
            "\r\n\r\n",
        );
      });
      socket.on("close", resolve);
      socket.on("error", reject);
    });
    assert.deepEqual(events, [
      { event: "client_error", code: "HEADER_OVERFLOW" },
    ]);
  } finally {
    await server.close();
  }
});
