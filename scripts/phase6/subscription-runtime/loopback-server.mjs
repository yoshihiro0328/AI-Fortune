import http from "node:http";

// Bind each loopback address explicitly. Never use :: or 0.0.0.0: localhost
// can resolve to either family, but this test must not be exposed to the LAN.
export async function listenLoopback(handler, port, record = () => {}) {
  const servers = [];
  const close = async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
          }),
      ),
    );
  };
  try {
    for (const host of ["127.0.0.1", "::1"]) {
      // Old localhost test namespaces can accumulate across ports. Accept a
      // bounded envelope so the cookie adapter can discard foreign namespaces;
      // it still enforces the original 16 KiB on all headers used by the app.
      const server = http.createServer({ maxHeaderSize: 128 * 1024 }, handler);
      server.requestTimeout = 45000;
      server.on("clientError", (error, socket) => {
        // Parser errors may contain raw HTTP headers. Record only a fixed code.
        record({
          event: "client_error",
          code:
            error.code === "HPE_HEADER_OVERFLOW"
              ? "HEADER_OVERFLOW"
              : "HTTP_PARSE_REJECTED",
        });
        socket.destroy();
      });
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({ port, host, ipv6Only: host === "::1" }, resolve);
      });
      port = server.address().port;
    }
    return {
      port,
      close,
      addresses: servers.map((server) => server.address()),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
