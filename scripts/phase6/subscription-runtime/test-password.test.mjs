import { test } from "node:test";
import assert from "node:assert/strict";
import { testPassword, validTestPassword } from "./test-password.mjs";
import { fixture, retainedRecords } from "./provider-fixture.mjs";
import { retainedPlan } from "./retained-plan.mjs";
test("temporary passwords always meet character classes and bcrypt size", () => {
  const values = new Set();
  for (let n = 0; n < 1000; n++) {
    const p = testPassword();
    assert(validTestPassword(p));
    assert(p.length >= 40 && Buffer.byteLength(p) < 72);
    for (const r of [/[a-z]/, /[A-Z]/, /[0-9]/, /[!@#$%^&*()]/])
      assert(r.test(p));
    values.add(p);
  }
  assert.equal(values.size, 1000);
});
test("a missing class in either password is rejected before either user update", async () => {
  const t = await fixture("normal", undefined, true, true);
  try {
    const records = await retainedRecords(t);
    await assert.rejects(
      t.ops.prepareAuthentication(records.after, {
        c: "SyntheticOnly123!",
        d: "SyntheticOnly123",
      }),
      /PASSWORD_CLASSES_REQUIRED/,
    );
    assert.equal(t.calls.filter((c) => c.method === "PUT").length, 0);
  } finally {
    await t.close();
  }
});
test("additive rejection reconciliation permits only proven weak-password non-mutation", async () => {
  const t = await fixture("normal", undefined, true, true);
  try {
    const input = await retainedRecords(t),
      c = input.closure.completion.closure;
    Object.assign(c, {
      complete: false,
      unresolvedOperations: 1,
      verifyRestoration: "failed_or_unknown",
    });
    for (const k of [
      "stopProcesses",
      "endContracts",
      "deactivatePrice",
      "restorePortalBinding",
      "revokeKeys",
      "eraseTemporary",
    ])
      c[k] = "verified";
    input.closure.reconciliation = {
      sourceAttemptId: input.priorPlan.attemptId,
      userId: input.priorPlan.manifest.d.id,
      operation: "resetDedicatedPasswords",
      httpStatus: 422,
      code: "weak_password",
      source: "supabase-auth-logs",
      requestWindowStart: "2026-10-22T16:29:30Z",
      currentUpdatedAt: "2026-10-22T14:08:37Z",
      noCheckoutOrContract: true,
      protectedBaselineUnchanged: true,
    };
    assert(retainedPlan(input));
    assert.equal(c.complete, false);
    for (const delta of [
      { httpStatus: 500 },
      { code: "unknown" },
      { userId: input.priorPlan.manifest.c.id },
      { currentUpdatedAt: "changed" },
      { currentUpdatedAt: "2026-10-22T16:29:31Z" },
      { requestWindowStart: undefined },
      { noCheckoutOrContract: false },
    ])
      assert.throws(() =>
        retainedPlan({
          ...input,
          closure: {
            ...input.closure,
            reconciliation: { ...input.closure.reconciliation, ...delta },
          },
        }),
      );
  } finally {
    await t.close();
  }
});
