import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PassThrough } from "node:stream";
import {
  routeName,
  VerificationPolicy,
  ratesUnchangedExcept,
} from "./network.mjs";
import { safeRequest } from "../payment-continuation/network.mjs";
import { control } from "./control.mjs";
import { isolatedReady } from "./isolated.mjs";
import { TARGET } from "../payment-runtime/policy.mjs";
test("prior diagnosis-list denial reproduced; only first page GET allowed, forbidden routes and mutations remain denied", () => {
  const id = "20000000-0000-4000-8000-000000000001";
  assert.equal(safeRequest("GET", "/api/diagnoses"), false);
  assert.equal(
    routeName("GET", "/api/diagnoses?offset=0", id),
    "diagnosis_list",
  );
  for (const [method, url] of [
    ["POST", "/api/diagnoses"],
    ["GET", "/api/diagnoses?offset=20"],
    ["GET", "/api/billing"],
    ["GET", "/api/consultations"],
    ["POST", "/api/events"],
    ["POST", `/api/diagnoses/${id}/report`],
    ["POST", "/api/webhooks/stripe"],
    ["GET", "/report/wrong"],
  ])
    assert.equal(routeName(method, url, id), null);
});
test("verification control refuses body and cannot call a writing action", () => {
  for (const command of ["body", "duplicate", "purchase"]) {
    const input = new PassThrough();
    input.isTTY = true;
    let reason;
    const c = control({
      input,
      stop: (x) => (reason = x),
      status: () => ({ ready: true }),
      action: () => assert.fail("must not execute"),
      record: () => {},
      write: () => {},
    });
    input.write(command + "\n");
    assert.equal(reason, "invalid_or_busy_command");
    c.close();
    input.destroy();
  }
});
test("ready state uses real 17 migrations; exact anonymous list guard and provider prohibition", async () => {
  const d = await isolatedReady();
  try {
    const p = new VerificationPolicy(d.m, d.expected);
    p.ready = true;
    const q = new URLSearchParams({
      select: "id,status,created_at",
      anonymous_session_id: "eq." + p.sessions[d.m.a.id],
      user_id: "is.null",
      order: "created_at.desc",
      offset: "0",
      limit: "20",
    });
    const request = {
      method: "GET",
      url: TARGET.supabase + "/rest/v1/diagnoses?" + q,
      headers: {
        apikey: "local-service",
        authorization: "Bearer local-service",
      },
    };
    const t = p.authorize(request),
      r = await d.transport(request);
    p.accept(t, r.status, JSON.parse(r.text));
    assert.deepEqual(JSON.parse(r.text), []);
    q.set("anonymous_session_id", "eq.wrong");
    assert.throws(() =>
      p.authorize({
        ...request,
        url: TARGET.supabase + "/rest/v1/diagnoses?" + q,
      }),
    );
    for (const url of [
      "https://api.stripe.com/v1/account",
      "https://api.openai.com/v1/models",
      "https://rnvrdrfdbapfafwjbygo.supabase.co/rest/v1/profiles",
    ])
      assert.throws(() => p.authorize({ ...request, url }));
    for (const route of [
      "paid_reports",
      "payments",
      "price_versions",
      "rpc/apply_stripe_event_v2",
    ])
      assert.throws(() =>
        p.authorize({
          ...request,
          method: "POST",
          url: TARGET.supabase + "/rest/v1/" + route,
          body: "{}",
        }),
      );
    const key = [...p.rates.keys()].find((x) => x.startsWith("auth:"));
    assert.equal(
      ratesUnchangedExcept([{ key, count: 1 }], [{ key, count: 2 }], p).changed,
      1,
    );
    assert.throws(() =>
      ratesUnchangedExcept(
        [{ key: "other", count: 1 }],
        [{ key: "other", count: 2 }],
        p,
      ),
    );
    assert.throws(() => ratesUnchangedExcept([{ key, count: 1 }], [], p));
  } finally {
    await d.close();
  }
});
test("live launcher excludes SQL executor, DB password, Stripe CLI and report mutation command", () => {
  const source = fs.readFileSync(
    new URL("./launch.mjs", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "executeBody",
    "sql-executor",
    "startListener",
    "bodySql",
    "c.database.password",
  ])
    assert(!source.includes(forbidden));
  assert(source.includes("NO_DATABASE_INPUT"));
});
