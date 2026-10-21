import { check } from "./policy.mjs";

// This change needs explicit approval before production input can be assembled.
// It does not change the trial or the absolute secret-receipt deadline.
export function ownerKeyWindow(approval, secretDeadline, now = Date.now()) {
  check(
    approval?.approved === true &&
      approval.waitMs === 300000 &&
      approval.reference === "owner-key-wait-5min" &&
      Number.isSafeInteger(secretDeadline) &&
      secretDeadline > 0 &&
      secretDeadline - now <= 7200000,
    "OWNER_KEY_WINDOW_NOT_APPROVED",
  );
  return {
    uiMs: Math.max(0, Math.min(approval.waitMs, secretDeadline - now - 20000)),
    readMs: Math.max(0, Math.min(15000, secretDeadline - now - 5000)),
  };
}
