import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, retainedRecords } from "./provider-fixture.mjs";
import { retainedPlan } from "./retained-plan.mjs";
import { retainedResume } from "./retained-resume.mjs";

test("real resume planner preserves identities and baseline, replaces only temporary session material", async () => {
  const t = await fixture("normal", undefined, true, true);
  try {
    const input = await retainedRecords(t),
      before = structuredClone(input);
    // Cleanup may have changed only target price/settings update timestamps.
    input.after.price_versions.find((p) => p.id === t.m.version).updated_at =
      "2026-10-21T00:00:00Z";
    const p = retainedPlan(input);
    assert.notEqual(p.attemptId, input.priorPlan.attemptId);
    assert.equal(p.manifest.previousAttemptId, input.priorPlan.attemptId);
    assert.equal(p.manifest.run, t.m.run);
    for (const key of ["c", "d"]) {
      assert.equal(p.manifest[key].id, t.m[key].id);
      assert.equal(p.manifest[key].email, t.m[key].email);
      assert.notEqual(p.manifest[key].cookie, t.m[key].cookie);
    }
    assert.notEqual(p.manifest.sessionSecret, t.m.sessionSecret);
    assert.equal(p.manifest.customer, input.retained.customer);
    assert.equal(p.manifest.portal, input.retained.portal);
    assert.deepEqual(p.expected, input.after);
    assert.deepEqual(input.priorPlan, before.priorPlan);
    assert.deepEqual(
      retainedResume(p.manifest, p.attemptId),
      p.manifest.resume,
    );
    for (const mutate of [
      (x) => {
        x.retained.c.profileCount = 1;
      },
      (x) => {
        x.retained.customerBinding = "absent";
      },
      (x) => {
        x.closure.revocation.api.app = "unverified";
      },
      (x) => {
        x.closure.temporaryFiles["credentials.json"] = "present";
      },
      (x) => {
        x.after.service_settings[0].portal_configuration_id = "bpc_changed";
      },
    ]) {
      const bad = structuredClone(input);
      mutate(bad);
      assert.throws(() => retainedPlan(bad));
    }
    const notApproved = retainedPlan({
      ...input,
      approval: {
        resetDedicatedPasswords: false,
        reactivateRetainedPortal: false,
        reference: "pending",
      },
    });
    assert.throws(
      () => retainedResume(notApproved.manifest, notApproved.attemptId),
      /RESUME_DIFFERENCE_APPROVAL_REQUIRED/,
    );
  } finally {
    await t.close();
  }
});
