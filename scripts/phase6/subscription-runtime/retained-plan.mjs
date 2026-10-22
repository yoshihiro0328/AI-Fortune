import { randomBytes, randomUUID } from "node:crypto";
import { check, sha, TARGET } from "./policy.mjs";
import { minimal } from "./minimal-profile.mjs";

// Pure local plan construction from the completed attempt's records. No provider
// calls, files, old passwords or old browser sessions. Provider operations still
// require the two specific approvals before any request can be made.
export function retainedPlan({
  priorPlan,
  retained,
  closure,
  after,
  approval,
}) {
  const old = priorPlan.manifest;
  check(
    minimal(old) &&
      priorPlan.clockApproval === null &&
      retained.sourceAttemptId === priorPlan.attemptId &&
      retained.account === TARGET.account &&
      retained.project === TARGET.ref,
    "RETAINED_RECORD_MISMATCH",
  );
  check(
    (closure.completion.closure.complete === true ||
      resolvedPasswordRejection(closure, priorPlan)) &&
      closure.revocation.apiComplete === true &&
      ["listener", "app", "lifecycle"].every(
        (k) => closure.revocation.api[k] === "revoked",
      ) &&
      [
        "base-credentials.json",
        "stripe-keys.json",
        "credentials.json",
        "plan.json",
      ].every((k) => closure.temporaryFiles[k] === "absent"),
    "PRIOR_CLOSURE_REQUIRED",
  );
  check(
    retained.passwords === "erased_not_recoverable" &&
      retained.portalActive === false &&
      retained.customerBinding === "retained" &&
      retained.dbPriceActive === false &&
      retained.stripePriceActive === true &&
      ["checkoutCount", "subscriptionCount", "paymentCount"].every(
        (k) => retained[k] === 0,
      ),
    "RETAINED_START_STATE_MISMATCH",
  );
  for (const label of ["c", "d"])
    check(
      retained[label].id === old[label].id &&
        retained[label].email === old[label].email &&
        [0, 1].includes(retained[label].profileCount) &&
        (retained[label].profiles ?? []).length ===
          retained[label].profileCount &&
        (retained[label].profiles ?? []).every(
          (p) => p.user_id === old[label].id,
        ),
      "RETAINED_USER_RECORD_MISMATCH",
    );
  // Preserve the historical comparison; cleanup changes only these timestamps.
  // The restored observation becomes this attempt's exact starting comparison.
  const normalize = (observation) =>
    Object.fromEntries(
      Object.entries(observation).map(([key, rows]) => [
        key,
        ["price_versions", "service_settings"].includes(key)
          ? rows.map((row) =>
              key === "service_settings" || row.id === old.version
                ? Object.fromEntries(
                    Object.entries(row).filter(
                      ([field]) => field !== "updated_at",
                    ),
                  )
                : row,
            )
          : rows,
      ]),
    );
  check(
    sha(normalize(priorPlan.expected)) === sha(normalize(after)),
    "RETAINED_BASELINE_DRIFT",
  );
  const nonce = () => randomBytes(32).toString("hex");
  return {
    ...structuredClone(priorPlan),
    attemptId: randomUUID(),
    expected: structuredClone(after),
    manifest: {
      ...structuredClone(old),
      previousAttemptId: retained.sourceAttemptId,
      c: { id: old.c.id, email: old.c.email, cookie: nonce() },
      d: { id: old.d.id, email: old.d.email, cookie: nonce() },
      sessionSecret: nonce(),
      customer: retained.customer,
      portal: retained.portal,
      clock: null,
      resume: {
        sourceAttemptId: retained.sourceAttemptId,
        customer: retained.customer,
        portal: retained.portal,
        profiles: Object.fromEntries(
          ["c", "d"].map((label) => [
            label,
            structuredClone(retained[label].profiles ?? []),
          ]),
        ),
        approval: structuredClone(approval),
      },
    },
  };
}

// An additive reconciliation, never rewriting the historical failed closure.
// Only an explicitly identified, provider-rejected D update can use this path.
export function resolvedPasswordRejection(closure, priorPlan) {
  const c = closure.completion.closure,
    r = closure.reconciliation;
  return (
    c.complete === false &&
    c.unresolvedOperations === 1 &&
    c.verifyRestoration === "failed_or_unknown" &&
    [
      "stopProcesses",
      "endContracts",
      "deactivatePrice",
      "restorePortalBinding",
      "revokeKeys",
      "eraseTemporary",
    ].every((k) => c[k] === "verified") &&
    r?.sourceAttemptId === priorPlan.attemptId &&
    r.userId === priorPlan.manifest.d.id &&
    r.operation === "resetDedicatedPasswords" &&
    r.httpStatus === 422 &&
    r.code === "weak_password" &&
    r.source === "supabase-auth-logs" &&
    Number.isFinite(Date.parse(r.currentUpdatedAt)) &&
    Number.isFinite(Date.parse(r.requestWindowStart)) &&
    Date.parse(r.currentUpdatedAt) < Date.parse(r.requestWindowStart) &&
    r.noCheckoutOrContract === true &&
    r.protectedBaselineUnchanged === true
  );
}
