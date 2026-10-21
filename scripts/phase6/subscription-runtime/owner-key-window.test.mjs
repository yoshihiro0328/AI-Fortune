import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerKeyWindow } from "./owner-key-window.mjs";
import { revokeAndVerify } from "./revocation.mjs";
import { closeAttempt } from "./runtime.mjs";
const approval = {
  approved: true,
  waitMs: 300000,
  reference: "owner-key-wait-5min",
};

test("owner waiting requires exact approval and reserves reads/erasure within original secret deadline", () => {
  const now = 1000000;
  for (const a of [
    undefined,
    { ...approval, approved: false },
    { ...approval, waitMs: 300001 },
    { ...approval, reference: "unapproved" },
  ])
    assert.throws(() => ownerKeyWindow(a, now + 7200000, now));
  assert.throws(() => ownerKeyWindow(approval, now + 7200001, now));
  assert.deepEqual(ownerKeyWindow(approval, now + 7200000, now), {
    uiMs: 300000,
    readMs: 15000,
  });
  assert.deepEqual(ownerKeyWindow(approval, now + 21000, now), {
    uiMs: 1000,
    readMs: 15000,
  });
  assert.deepEqual(ownerKeyWindow(approval, now + 6000, now), {
    uiMs: 0,
    readMs: 1000,
  });
  assert.deepEqual(ownerKeyWindow(approval, now - 1, now), {
    uiMs: 0,
    readMs: 0,
  });
});

for (const expired of [false, true]) {
  test(
    "owner closure records results and erases even at secret deadline: " +
      expired,
    async () => {
      const calls = [],
        saved = [];
      const actions = Object.fromEntries(
        [
          "stopProcesses",
          "endContracts",
          "deactivatePrice",
          "restorePortalBinding",
        ].map((k) => [k, async () => true]),
      );
      actions.revokeKeys = () =>
        revokeAndVerify({
          ownerApproval: approval,
          secretDeadline: Date.now() + (expired ? -1 : 60000),
          revoke: async () => {
            calls.push("owner");
            return true;
          },
          wire: async (r) => {
            calls.push(r.role);
            throw Object.assign(Error("api_key_expired"), { httpStatus: 401 });
          },
          save: (name, value) => {
            saved.push(value);
            return { verified: true };
          },
        });
      actions.eraseTemporary = async () => {
        calls.push("erase");
        return true;
      };
      const result = await closeAttempt(actions);
      assert.equal(result.complete, !expired);
      assert.equal(result.eraseTemporary, "verified");
      assert.deepEqual(
        calls,
        expired
          ? ["erase"]
          : ["owner", "listener", "app", "lifecycle", "erase"],
      );
      assert.equal(saved.length, 1);
      assert.equal(saved[0].apiComplete, !expired);
    },
  );
}
