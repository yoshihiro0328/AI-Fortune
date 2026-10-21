import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./provider-fixture.mjs";
import { retainedResume } from "./retained-resume.mjs";

const passwords = { c: "SyntheticOnly123!", d: "SyntheticOnly123!" };
const mutations = (t) => t.calls.filter((c) => c.method !== "GET");

test("retained resume needs specific password and Portal approval before requests", async () => {
  const t = await fixture("normal", undefined, true, true);
  try {
    for (const key of ["resetDedicatedPasswords", "reactivateRetainedPortal"]) {
      const m = structuredClone(t.m);
      m.resume.approval[key] = false;
      assert.throws(
        () => retainedResume(m, randomUUID()),
        /RESUME_DIFFERENCE_APPROVAL_REQUIRED/,
      );
    }
    assert.throws(
      () => retainedResume(t.m, t.m.resume.sourceAttemptId),
      /RESUME_IDENTITY_REQUIRED/,
    );
    assert.equal(t.calls.length, 0);
  } finally {
    await t.close();
  }
});

for (const problem of [
  "profile",
  "user",
  "binding",
  "checkout",
  "customer",
  "contract",
  "invoice",
  "portal",
  "portal-feature",
  "price",
])
  test("retained resume stops before mutations: " + problem, async () => {
    const t = await fixture("normal", undefined, true, true);
    try {
      const expected = await t.ops.observe();
      if (problem === "profile")
        await t.pg.query("insert into profiles(user_id) values($1)", [
          t.m.c.id,
        ]);
      if (problem === "user")
        t.authUsers.get(t.m.c.id).email = "different@synthetic.invalid";
      if (problem === "binding") t.m.resume.customer = "cus_wrong";
      if (problem === "checkout")
        await t.pg.query(
          "update billing_customers set checkout_session_id='cs_test_unknown' where user_id=$1",
          [t.m.c.id],
        );
      if (problem === "customer")
        t.objects.customer.metadata.user_id = t.m.d.id;
      if (problem === "contract")
        t.objects.sub_existing = { id: "sub_existing" };
      if (problem === "invoice")
        t.objects.invoices = [{ customer: "cus_http", id: "in_existing" }];
      if (problem === "portal") t.objects.portal.active = true;
      if (problem === "portal-feature")
        t.objects.portal.features.subscription_update.enabled = true;
      if (problem === "price")
        await t.pg.query("update price_versions set active=true where id=$1", [
          t.m.version,
        ]);
      await assert.rejects(t.ops.inspect(expected));
      await assert.rejects(
        t.ops.prepare(passwords),
        /STOPPED|ALREADY_RESERVED/,
      );
      assert.equal(mutations(t).length, 0);
    } finally {
      await t.close();
    }
  });

for (const mode of [
  "resume-password-unknown",
  "resume-portal-unknown",
  "cleanup-fail",
])
  test(
    "retained resume uncertain mutation is not replayed, independent cleanup proceeds: " +
      mode,
    async () => {
      const t = await fixture(mode, undefined, true, true);
      try {
        await t.ops.inspect(await t.ops.observe());
        if (mode === "cleanup-fail") await t.ops.prepare(passwords);
        else
          await assert.rejects(t.ops.prepare(passwords), /RESULT_UNKNOWN_STOP/);
        await assert.rejects(
          t.ops.prepare(passwords),
          /STOPPED|ALREADY_RESERVED/,
        );
        if (mode === "cleanup-fail") t.objects.portal.active = true;
        const result = await t.ops.cleanup();
        assert.equal(result.complete, false);
        assert.equal(result.deactivateDatabasePrice, "verified");
        assert.equal(result.restoreDatabasePortal, "verified");
        assert.equal(t.objects.price.active, true);
        assert.equal(
          t.calls.filter((c) => c.method === "PUT").length,
          mode === "resume-password-unknown" ? 1 : 2,
        );
        assert.equal(
          t.calls.filter(
            (c) => c.method === "POST" && c.form?.active === "true",
          ).length,
          mode === "resume-password-unknown" ? 0 : 1,
        );
        if (mode !== "cleanup-fail")
          assert.equal(t.objects.portal.active, false);
        for (const p of [
          "/auth/v1/admin/users",
          "/v1/customers",
          "/v1/billing_portal/configurations",
          "/rest/v1/billing_customers",
        ])
          assert.equal(
            t.calls.filter((c) => c.p === p && c.method === "POST").length,
            0,
          );
        assert.equal(await t.protectedState(), t.original);
      } finally {
        await t.close();
      }
    },
  );

test("password update sender permits only the scoped reset operation and body", async () => {
  const t = await fixture("normal", undefined, true, true);
  try {
    const request = {
      provider: "supabase",
      role: "service",
      method: "PUT",
      path: "/auth/v1/admin/users/" + t.m.c.id,
      operation: "reset_retained_password",
      body: { password: passwords.c },
    };
    for (const delta of [
      { operation: "update_user" },
      { role: "anon" },
      { path: "/auth/v1/admin/users/" + randomUUID() },
      { body: { password: passwords.c, email: "changed@synthetic.invalid" } },
      { path: "/auth/v1/admin/users" },
    ])
      await assert.rejects(
        t.wire({ ...request, ...delta }),
        /PASSWORD_RESET_SCOPE_DENIED/,
      );
    assert.equal(t.calls.length, 0);
  } finally {
    await t.close();
  }
});
