import { check, TARGET } from "./policy.mjs";

// localhost cookies are shared across ports. Only this runtime's namespace is
// visible to Next/Supabase; unrelated browser sessions are never read or erased.
export function browserCookies(namespace) {
  check(/^plus-[a-f0-9]{32}--$/.test(namespace), "COOKIE_NAMESPACE_REQUIRED");
  const auth = `sb-${TARGET.ref}-auth-token`;
  const allowed = (name) =>
    [
      "yorisoi_session",
      "yorisoi_recovery",
      auth,
      auth + "-code-verifier",
    ].includes(name) ||
    new RegExp(`^${auth}(?:-code-verifier)?\\.\\d+$`).test(name);
  function incoming(header = "") {
    const seen = new Set(),
      pairs = [];
    let foreignAuth = false;
    for (const part of header.split(";")) {
      const pair = part.trim(),
        equal = pair.indexOf("=");
      if (equal < 1) continue;
      const name = pair.slice(0, equal);
      if (!name.startsWith(namespace)) {
        foreignAuth ||= name.startsWith("sb-");
        continue;
      }
      const local = name.slice(namespace.length);
      check(allowed(local) && !seen.has(local), "AMBIGUOUS_TEST_COOKIE");
      seen.add(local);
      pairs.push(local + pair.slice(equal));
    }
    return {
      header: pairs.join("; "),
      foreignAuth,
      authenticated:
        seen.has(auth) || [...seen].some((n) => n.startsWith(auth + ".")),
    };
  }
  function outgoing(value) {
    const one = (line) => {
      check(typeof line === "string", "INVALID_SET_COOKIE");
      const equal = line.indexOf("=");
      const name = line.slice(0, equal);
      const alreadyScoped = name.startsWith(namespace);
      check(
        equal > 0 &&
          allowed(alreadyScoped ? name.slice(namespace.length) : name),
        "UNSCOPED_TEST_COOKIE",
      );
      // Next appends by reading the headers already sent through this adapter.
      // Preserve our own validated prefix; foreign namespaces remain denied.
      return alreadyScoped ? line : namespace + line;
    };
    return Array.isArray(value) ? value.map(one) : one(value);
  }
  function install(req, res) {
    const scoped = incoming(req.headers.cookie);
    req.headers.cookie = scoped.header;
    const set = res.setHeader.bind(res);
    res.setHeader = (name, value) =>
      set(name, name.toLowerCase() === "set-cookie" ? outgoing(value) : value);
    return scoped;
  }
  return { incoming, outgoing, install };
}
