// Preparation only: no credentials, network, environment loading or live adapter.
// These limits describe a PROPOSED new approval, not the earlier C purchase scope.
export const remainingPlan = Object.freeze({
  account: "acct_1UQlQdI73kTcvXz8",
  project: "ukdzggjfkcwjssjmnqim",
  targets: ["renewal", "failure"],
  limits: {
    users: 2,
    customers: 2,
    clocks: 2,
    subscriptions: 2,
    successfulPayments: 3,
    failedPaymentAttempts: 9,
    clockAdvances: 16,
    scheduledCancellations: 1,
    immediateCancellations: 2,
    invoiceVoids: 1,
    paymentMethodAttachments: 3,
    paymentMethodSwitches: 1,
    checkoutSessions: 0,
    portalSessions: 0,
    retriesByWork: 0,
    protectedRecordWrites: 0,
    catalogWrites: 0,
    globalSettingsWrites: 0,
    clockDeletes: 0,
  },
  runtimeSeconds: 1200,
  cleanupSeconds: 60,
  ownerRevocationWaitSeconds: 300,
  secretLifetimeSeconds: 7200,
});

// A global stop is latched BEFORE dispatch. Unknown external outcomes consume the
// allowance and block further writes; only bounded read reconciliation/cleanup
// is permitted by the runbook. This object deliberately cannot perform writes.
export function operationLedger(plan = remainingPlan, carry = {}) {
  const used = Object.fromEntries(Object.keys(plan.limits).map((k) => [k, 0]));
  for (const [key, value] of Object.entries(carry)) {
    if (
      !Object.hasOwn(used, key) ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > plan.limits[key]
    )
      throw Error("REMAINING_PLAN_CARRY_DENIED");
    used[key] = value;
  }
  const issued = new Set();
  let stopped = false;
  return {
    reserve(operation, requestLabel) {
      if (
        stopped ||
        !Object.hasOwn(used, operation) ||
        typeof requestLabel !== "string" ||
        !/^[a-z0-9-]{1,64}$/.test(requestLabel) ||
        issued.has(requestLabel) ||
        used[operation] >= plan.limits[operation]
      )
        throw Error("REMAINING_PLAN_OPERATION_DENIED");
      issued.add(requestLabel);
      used[operation]++;
    },
    unknown() {
      stopped = true;
    },
    summary() {
      return { used: { ...used }, stopped };
    },
  };
}

// Consume only a pre-filtered nonsecret witness, never a Stripe response or URL.
// The caller must establish the no-other-writer interval from its process audit.
export function cancellationVerdict(w) {
  const fields = [
    "kind",
    "beforePlan",
    "afterPlan",
    "beforeStatus",
    "afterStatus",
    "sameSubscription",
    "eventType",
    "sameEvent",
    "signatureVerified",
    "httpStatus",
    "committed",
    "noOtherWriter",
    "chronological",
  ];
  if (
    !w ||
    Object.keys(w).some((k) => !fields.includes(k)) ||
    !["isolated", "sandbox"].includes(w.kind)
  )
    throw Error("NONSECRET_WITNESS_REQUIRED");
  const verified =
    w.beforePlan === "plus" &&
    w.afterPlan === "free" &&
    w.beforeStatus === "active" &&
    w.afterStatus === "canceled" &&
    w.sameSubscription === true &&
    w.eventType === "customer.subscription.deleted" &&
    w.sameEvent === true &&
    w.signatureVerified === true &&
    w.httpStatus === 200 &&
    w.committed === true &&
    w.noOtherWriter === true &&
    w.chronological === true;
  return { kind: w.kind, verified, historicalProof: false };
}

// Candidate model for every evaluated path; not a production model change.
// Standard short-context rates, allowing the more expensive 12h cache write.
// Unknown usage is charged at this reservation, never refunded/retried for free.
export const aiEvaluation = Object.freeze({
  model: "gpt-6-luna",
  serviceTier: "default",
  store: false,
  consultation: {
    cases: 14,
    callsPerCase: 3,
    inputTokens: 12000,
    outputTokens: 2400,
  },
  diagnosis: {
    cases: 10,
    callsPerCase: 80,
    inputTokens: 30000,
    outputTokens: 8500,
  },
  ratesUSDPerMillion: { inputCeiling: 0.25, output: 0.5 },
  proposedReservationUSD: 12,
  priceChecked: "2026-10-26",
});
export function aiReservation(plan = aiEvaluation) {
  const total = { calls: 0, inputTokens: 0, outputTokens: 0, modelUSD: 0 };
  for (const p of [plan.consultation, plan.diagnosis]) {
    const n = p.cases * p.callsPerCase;
    total.calls += n;
    total.inputTokens += n * p.inputTokens;
    total.outputTokens += n * p.outputTokens;
  }
  total.modelUSD =
    (total.inputTokens * plan.ratesUSDPerMillion.inputCeiling +
      total.outputTokens * plan.ratesUSDPerMillion.output) /
    1e6;
  return {
    ...total,
    withRegionalPremiumUSD: total.modelUSD * 1.1,
    taxIncluded: false,
    externalApprovalGranted: false,
  };
}
