import test from "node:test";
import assert from "node:assert/strict";
import {
  remainingPlan,
  operationLedger,
  cancellationVerdict,
  aiReservation,
} from "./remaining-plan.mjs";

test("proposed two-fixture cycle fits the fixed allowance and cannot repurchase", () => {
  const ledger = operationLedger();
  for (const op of [
    "users",
    "customers",
    "clocks",
    "subscriptions",
    "successfulPayments",
    "failedPaymentAttempts",
    "clockAdvances",
    "immediateCancellations",
    "invoiceVoids",
  ]) {
    for (let n = 0; n < remainingPlan.limits[op]; n++)
      ledger.reserve(op, `${op.toLowerCase()}-${n}`);
    assert.throws(() => ledger.reserve(op, `${op.toLowerCase()}-extra`));
  }
  for (const op of [
    "checkoutSessions",
    "portalSessions",
    "catalogWrites",
    "globalSettingsWrites",
    "protectedRecordWrites",
    "clockDeletes",
  ])
    assert.throws(() => ledger.reserve(op, "forbidden"));
});
test("a dispatched unknown result consumes its allowance and latches the write stop", () => {
  const ledger = operationLedger();
  ledger.reserve("subscriptions", "renewal-sub");
  assert.throws(() => ledger.reserve("subscriptions", "renewal-sub"));
  ledger.unknown();
  assert.throws(() => ledger.reserve("subscriptions", "failure-sub"));
  assert.equal(ledger.summary().used.subscriptions, 1);
});
test("unknown operation and potentially secret labels are never included in errors", () => {
  const ledger = operationLedger();
  assert.throws(
    () => ledger.reserve("unexpected", "synthetic-sensitive-value"),
    { message: "REMAINING_PLAN_OPERATION_DENIED" },
  );
  assert.throws(
    () =>
      ledger.reserve(
        "subscriptions",
        "https://fixture.invalid/?secret=synthetic",
      ),
    { message: "REMAINING_PLAN_OPERATION_DENIED" },
  );
});
const witness = {
  kind: "isolated",
  beforePlan: "plus",
  afterPlan: "free",
  beforeStatus: "active",
  afterStatus: "canceled",
  sameSubscription: true,
  eventType: "customer.subscription.deleted",
  sameEvent: true,
  signatureVerified: true,
  httpStatus: 200,
  committed: true,
  noOtherWriter: true,
  chronological: true,
};
test("synthetic proof remains synthetic and does not manufacture historical proof", () => {
  assert.deepEqual(cancellationVerdict(witness), {
    kind: "isolated",
    verified: true,
    historicalProof: false,
  });
});
for (const [field, value] of [
  ["sameEvent", false],
  ["sameSubscription", false],
  ["signatureVerified", false],
  ["httpStatus", 500],
  ["committed", false],
  ["noOtherWriter", false],
  ["chronological", false],
  ["beforePlan", "free"],
]) {
  test(`Free is insufficient when ${field} is missing or false`, () => {
    assert.equal(
      cancellationVerdict({ ...witness, [field]: value }).verified,
      false,
    );
    const partial = { ...witness };
    delete partial[field];
    assert.equal(cancellationVerdict(partial).verified, false);
  });
}
test("raw provider payloads and access URLs are refused without echo", () => {
  assert.throws(
    () => cancellationVerdict({ ...witness, url: "synthetic-sensitive-value" }),
    { message: "NONSECRET_WITNESS_REQUIRED" },
  );
});
test("AI proposal includes all attempts, cache writes and premium, but grants no spend authority", () => {
  const cost = aiReservation();
  assert.equal(cost.calls, 842);
  assert.equal(cost.inputTokens, 24504000);
  assert.equal(cost.outputTokens, 6900800);
  assert.ok(Math.abs(cost.modelUSD - 9.5764) < 1e-8);
  assert.ok(Math.abs(cost.withRegionalPremiumUSD - 10.53404) < 1e-8);
  assert.equal(cost.externalApprovalGranted, false);
  assert.equal(cost.taxIncluded, false);
});
