import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  restrictedKeyFormState,
  inspectRestrictedKeyDraft,
  restrictedKeySubmitOnce,
} from "./restricted-key-form.mjs";

const create =
  "https://dashboard.stripe.com/acct_1UQlQdI73kTcvXz8/test/apikeys/create";
const name = "yorisoi-plus-1234abcd-app";
const permissions = [["Accounts", "読み取り"]];
const evaluate = (url, document, expectedName = name) =>
  vm.runInNewContext(`(${restrictedKeyFormState.toString()})(arg)`, {
    location: { href: url },
    document,
    arg: { expectedName },
  });
const forbiddenDOM = new Proxy(
  {},
  {
    get() {
      throw Error("DOM_MUST_NOT_BE_READ");
    },
  },
);
function draft(value = name, rows = permissions) {
  return {
    querySelector: () => ({ value }),
    querySelectorAll: () => [
      { children: [], querySelectorAll: () => [], querySelector: () => null },
      ...rows.map(([resource, choice]) => ({
        children: [{ textContent: resource }],
        querySelectorAll: () => [{ textContent: choice }],
        querySelector: () => null,
      })),
    ],
  };
}
test("key list, detail, foreign account and redirect are denied without DOM reads", () => {
  for (const url of [
    create.replace("/create", ""),
    create + "/detail",
    create.replace("acct_1UQlQdI73kTcvXz8", "acct_other"),
    create + "?redirect=list",
  ])
    assert.equal(evaluate(url, forbiddenDOM).allowed, false);
});
test("metadata denial never invokes page evaluation", async () => {
  const result = await inspectRestrictedKeyDraft(
    {
      url: async () => create.replace("/create", ""),
      playwright: {
        evaluate() {
          throw Error("NO_EVALUATION");
        },
      },
    },
    name,
  );
  assert.deepEqual(result, { allowed: false });
});
test("redirect after metadata check is denied before reading redirected DOM", async () => {
  const result = await inspectRestrictedKeyDraft(
    {
      url: async () => create,
      playwright: {
        evaluate: () => evaluate(create.replace("/create", ""), forbiddenDOM),
      },
    },
    name,
  );
  assert.equal(result.allowed, false);
});
test("missing draft, unexpected name or resource returns no page text", () => {
  const sentinel = "SYNTHETIC_PRIVATE_SENTINEL";
  for (const doc of [
    { querySelector: () => null },
    draft(sentinel),
    draft(name, [[sentinel, "読み取り"]]),
  ]) {
    const result = evaluate(create, doc);
    assert.equal(result.allowed, false);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
  }
});
test("known draft returns only fixed permission labels and blank state", () => {
  assert.equal(evaluate(create, draft("")).blank, true);
  const result = evaluate(create, draft());
  assert.equal(result.allowed, true);
  assert.equal(result.blank, false);
  assert.equal(JSON.stringify(result.selected), JSON.stringify(permissions));
  assert.equal(JSON.stringify(result).includes(name), false);
});
test("broader permissions block submit; uncertain submit cannot be repeated", async () => {
  let submissions = 0;
  const submit = restrictedKeySubmitOnce();
  await assert.rejects(
    submit({
      inspect: async () => ({
        allowed: true,
        blank: false,
        selected: [["Accounts", "書き込み"]],
      }),
      submit: async () => submissions++,
      permissions,
    }),
    /KEY_DRAFT_DENIED/,
  );
  const args = {
    inspect: async () => ({
      allowed: true,
      blank: false,
      selected: permissions,
    }),
    submit: async () => {
      submissions++;
      throw Error("UNKNOWN_RESULT");
    },
    permissions,
  };
  await assert.rejects(submit(args), /UNKNOWN_RESULT/);
  await assert.rejects(submit(args), /KEY_SUBMIT_ALREADY_ATTEMPTED/);
  assert.equal(submissions, 1);
});
test("successful click makes no post-submit inspection", async () => {
  let inspections = 0;
  const result = await restrictedKeySubmitOnce()({
    inspect: async () => {
      inspections++;
      return { allowed: true, blank: false, selected: permissions };
    },
    submit: async () => {},
    permissions,
  });
  assert.equal(inspections, 1);
  assert.deepEqual(result, { submittedOnce: true, creationVerified: false });
});
