import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Policy, TARGET, validate, sessionHash } from "./policy.mjs";
import { journal } from "./journal.mjs";
import { closeAttempt } from "./runtime.mjs";
const m = {
  project: TARGET.ref,
  account: TARGET.account,
  app: TARGET.app,
  run: "30000000-0000-4000-8000-000000000001",
  synthetic: true,
  protectedUsers: [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
  ],
  c: {
    id: "30000000-0000-4000-8000-000000000002",
    email: "c@example.invalid",
    cookie: "synthetic-c",
  },
  d: {
    id: "30000000-0000-4000-8000-000000000003",
    email: "d@example.invalid",
    cookie: "synthetic-d",
  },
  sessionSecret: "synthetic-only",
  customer: "cus_local_plus",
  clock: "clock_local_plus",
  portal: "bpc_local_plus",
  price: "price_local_plus",
  product: "prod_local_plus",
  version: "plus-isolated",
  amount: 980,
  currency: "jpy",
  interval: "month",
};
for (const [field, value] of [
  ["project", "old"],
  ["account", "acct_other"],
  ["app", "https://old-preview.example"],
  ["amount", 1980],
  ["interval", "year"],
])
  test("manifest rejects " + field, () =>
    assert.throws(() => validate({ ...m, [field]: value })),
  );
test("protected A/B cannot become dedicated users", () =>
  assert.throws(() => validate({ ...m, protectedUsers: [m.c.id, m.d.id] })));
test("approved Portal-only cancellation never dispatches an app cancellation", () => {
  const policy = new Policy({ ...m, portalOnlyCancellation: true });
  policy.ids.add("sub_known");
  assert.throws(
    () =>
      policy.authorize({
        method: "POST",
        url: TARGET.stripe + "/v1/subscriptions/sub_known",
        body: "cancel_at_period_end=true",
      }),
    /PORTAL_ONLY/,
  );
});
for (const [method, url, body] of [
  ["GET", "https://api.openai.com/v1/models"],
  ["GET", "https://rnvrdrfdbapfafwjbygo.supabase.co/rest/v1/profiles"],
  ["GET", TARGET.stripe + "/v1/events"],
  ["GET", TARGET.stripe + "/v1/subscriptions?status=all"],
  ["POST", TARGET.stripe + "/v1/refunds", "{}"],
  ["POST", TARGET.supabase + "/rest/v1/rpc/manage_consultation", "{}"],
  ["DELETE", TARGET.supabase + "/rest/v1/paid_reports"],
  ["GET", TARGET.supabase + "/rest/v1/profiles?select=*"],
  ["POST", TARGET.supabase + "/auth/v1/signup", "{}"],
  [
    "POST",
    TARGET.supabase + "/rest/v1/rpc/claim_anonymous_diagnoses",
    JSON.stringify({ p_user: m.c.id, p_session: "other" }),
  ],
  [
    "PATCH",
    TARGET.supabase + "/rest/v1/price_versions?id=eq.other",
    '{"active":true}',
  ],
])
  test("deny " + method + " " + new URL(url).pathname, () =>
    assert.throws(() => new Policy(m).authorize({ method, url, body })),
  );
test("fresh empty claim and login budgets", () => {
  const p = new Policy(m),
    r = {
      method: "POST",
      url: TARGET.supabase + "/auth/v1/token?grant_type=password",
      body: JSON.stringify({ email: m.c.email, password: "synthetic" }),
    };
  p.authorize(r);
  assert.throws(() => p.authorize(r));
  p.authorize({
    method: "POST",
    url: TARGET.supabase + "/rest/v1/rpc/claim_anonymous_diagnoses",
    body: JSON.stringify({
      p_user: m.c.id,
      p_session: sessionHash(m, m.c.cookie),
    }),
  });
  assert.throws(() => p.accept({ kind: "claim_anonymous_diagnoses" }, 200, 1));
});
test("account, price and clock are independent identity checks", () => {
  const p = new Policy(m);
  assert.throws(() => p.accept({ kind: "account" }, 200, { id: "acct_other" }));
  assert.throws(() =>
    p.accept({ kind: "customer" }, 200, {
      id: m.customer,
      livemode: false,
      test_clock: "clock_other",
      metadata: { run: m.run, user_id: m.c.id },
    }),
  );
  assert.throws(() =>
    p.accept({ kind: "price" }, 200, {
      id: m.price,
      active: true,
      livemode: false,
      product: m.product,
      currency: "jpy",
      unit_amount: 1980,
      recurring: { interval: "month", interval_count: 1 },
    }),
  );
});
test("unknown write reserves once, stops, never blindly retries; old attempt preserved", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-journal-"));
  try {
    const file = path.join(dir, "attempt.jsonl"),
      j = journal(file, m.run, null);
    let n = 0;
    await assert.rejects(
      j.perform("createCustomer", { run: m.run }, async () => {
        n++;
        throw Error("unknown");
      }),
    );
    await assert.rejects(
      j.perform("createCustomer", { run: m.run }, async () => n++),
    );
    assert.equal(n, 1);
    j.close();
    assert.throws(() => journal(file, m.run, null));
    assert.match(fs.readFileSync(file, "utf8"), /unknown_or_failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
for (const failing of [
  "none",
  "stopProcesses",
  "endContracts",
  "deactivatePrice",
  "restorePortalBinding",
  "eraseTemporary",
  "revokeKeys",
])
  test("cleanup reports independent results: " + failing, async () => {
    const calls = [];
    const actions = Object.fromEntries(
      [
        "stopProcesses",
        "endContracts",
        "deactivatePrice",
        "restorePortalBinding",
        "eraseTemporary",
        "revokeKeys",
      ].map((n) => [
        n,
        async () => {
          calls.push(n);
          if (n === failing) throw Error("private-provider-response");
          return true;
        },
      ]),
    );
    const r = await closeAttempt(actions);
    assert.equal(calls.length, 6);
    assert.equal(r.complete, failing === "none");
    assert(!JSON.stringify(r).includes("private-provider"));
    if (failing !== "none") assert.equal(r[failing], "failed_or_unknown");
  });

test("invoice cap is four unique IDs across both subscriptions; rereads do not spend budget", () => {
  const p = new Policy(m);
  const invoice = (id, subscription) => ({
    id,
    customer: m.customer,
    livemode: false,
    parent: { subscription_details: { subscription } },
  });
  const accept = (subscription, ids) =>
    p.accept({ kind: "invoices", subscription }, 200, {
      has_more: false,
      data: ids.map((id) => invoice(id, subscription)),
    });
  accept("sub_first", ["in_1", "in_2", "in_3"]);
  accept("sub_first", ["in_1", "in_2", "in_3"]);
  accept("sub_second", ["in_4"]);
  assert.throws(() => accept("sub_second", ["in_4", "in_5"]), /INVOICE_LIMIT/);
  assert.equal(p.invoiceIds.size, 4);
  assert.throws(() =>
    p.accept({ kind: "invoices", subscription: "sub_first" }, 200, {
      has_more: false,
      data: [invoice("in_1", "sub_unrelated")],
    }),
  );
});
