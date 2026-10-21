import { test } from "node:test";
import assert from "node:assert/strict";
import { workLogin, WORK_LOGIN } from "./work-login.mjs";
import { appTransport } from "./app-transport.mjs";
import { TARGET } from "./policy.mjs";
const m = {
  scenario: "minimal-plus-v1",
  c: { email: "c@example.invalid" },
  d: { email: "d@example.invalid" },
};
const passwords = {
  c: "synthetic-parent-password-c",
  d: "synthetic-parent-password-d",
};
const request = (email = m.c.email, password = WORK_LOGIN) => ({
  url: TARGET.supabase + "/auth/v1/token?grant_type=password",
  method: "POST",
  headers: { apikey: "local-anon", authorization: "Bearer local-anon" },
  body: JSON.stringify({ email, password }),
});

test("only prepared C/D consume a login; parent sends actual password once", async () => {
  const login = workLogin(m, passwords),
    sent = [];
  let stopped = false;
  const transport = appTransport({
    login,
    operations: {
      state: () => ({ stopped }),
      runtimeFailed: () => {
        stopped = true;
      },
    },
    wire: async (r) => {
      sent.push(r);
      return { access_token: "synthetic-auth-response" };
    },
  });
  for (const role of ["c", "d"]) {
    const response = await transport(request(m[role].email));
    assert.equal(response.status, 200);
    const r = sent.at(-1);
    assert.equal(r.role, "anon");
    assert.equal(r.path, "/auth/v1/token?grant_type=password");
    assert.equal(JSON.parse(r.body).password, passwords[role]);
    assert(!response.text.includes(passwords[role]));
  }
  await assert.rejects(transport(request()), /RUNTIME_TRANSPORT_STOP/);
  assert.equal(sent.length, 2);
  assert(stopped);
  login.close();
});

test("unknown identity, ordinary password and closed mediator never transmit", () => {
  const login = workLogin(m, passwords);
  assert.throws(() => login.body(request("outside@example.invalid")), /DENIED/);
  assert.throws(
    () => login.body(request(m.c.email, "wrong-password")),
    /DENIED/,
  );
  assert.throws(() => workLogin({ ...m, scenario: "legacy" }, passwords));
  login.close();
  assert.throws(() => login.body(request()), /DENIED/);
});

test("unknown auth result consumes login and latches stop without revealing password", async () => {
  let count = 0,
    stopped = false;
  const transport = appTransport({
    login: workLogin(m, passwords),
    operations: {
      state: () => ({ stopped }),
      runtimeFailed: () => {
        stopped = true;
      },
    },
    wire: async () => {
      count++;
      throw Error("synthetic-unknown");
    },
  });
  await assert.rejects(transport(request()), {
    message: "RUNTIME_TRANSPORT_STOP",
  });
  await assert.rejects(transport(request()), /STOPPED/);
  assert.equal(count, 1);
});

test("refresh and other operations are unchanged; stopped runtime cannot log in", async () => {
  const login = workLogin(m, passwords);
  const r = {
    ...request(),
    url: TARGET.supabase + "/auth/v1/token?grant_type=refresh_token",
    body: "synthetic-refresh-body",
  };
  assert.equal(login.body(r), r.body);
  const transport = appTransport({
    login,
    operations: { state: () => ({ stopped: true }) },
    wire: () => {
      throw Error("must not send");
    },
  });
  await assert.rejects(transport(request()), /STOPPED/);
  login.close();
});
