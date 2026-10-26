import fs from "node:fs";
import { remainingPlan } from "./remaining-plan.mjs";

// Approved 2026-10-26 amendment. E is retained, terminal and NEVER a target.
// Internal e is the renewal scenario slot; its new public fixture name is G.
export const retainedE = "5615e8f4-228c-4d13-bc8d-36c511315d44";
export const resumedMonthlyPlan = Object.freeze({
  ...remainingPlan,
  limits: Object.freeze({
    ...remainingPlan.limits,
    users: 3,
    customers: 3,
    clocks: 3,
    subscriptions: 3,
    successfulPayments: 4,
    // One retained E method + G initial + F initial/failing; no extra switches.
    paymentMethodAttachments: 4,
  }),
});
export const monthlyCarry = Object.freeze({
  users: 1,
  customers: 1,
  clocks: 1,
  subscriptions: 1,
  successfulPayments: 1,
  clockAdvances: 1,
  paymentMethodAttachments: 1,
});
export const monthlyContinuation = Object.freeze({
  id: "after-ee8a0f00-approved-g-f",
  previousRun: "ee8a0f00-9fbc-4dbd-9605-e2333ebeb3db",
  roles: Object.freeze({ e: "G", f: "F" }),
  paidInvoice: "in_1UUgq2I73kTcvXz8QROcCwlv",
  // Reserved renewal was reconciled as draft/unpaid, then auto_advance=false.
  priorRenewal: "draft_unpaid_auto_advance_false",
  priorCancellationAttempts: 2,
  priorCancellationRecoverySeparatelyApproved: true,
  priorDraftStopSeparatelyApproved: true,
});

// Durable one-use claim: an unknown outcome must never reset the historical seed.
export function claimMonthlyContinuation(file, run) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(run)) throw Error("INVALID_RUN");
  const fd = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ run, continuation: monthlyContinuation.id }),
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
