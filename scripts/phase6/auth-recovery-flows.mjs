import { createRecoveryPolicy } from "./auth-recovery-policy.mjs";
import { bRecovery } from "./auth-password-recovery.mjs";
// Fixed existing test identity. Never accept a user ID from the browser.
export const aRecovery = createRecoveryPolicy(
  "a",
  "3ebfb150-ada7-4159-a080-52eced94cbd7",
);
export const resetStages = new Set([
  ...aRecovery.resetStages,
  ...bRecovery.resetStages,
]);
export function recoveryFlow(stage) {
  if (aRecovery.resetStages.has(stage)) return aRecovery;
  if (bRecovery.resetStages.has(stage)) return bRecovery;
  return null;
}
export function recoveryCallbackAllowed(url, stage) {
  return (recoveryFlow(stage) ?? bRecovery).recoveryCallbackAllowed(url, stage);
}
export function resetStageAllowed(url, method, stage, label, subject) {
  return (recoveryFlow(stage) ?? bRecovery).resetStageAllowed(
    url,
    method,
    stage,
    label,
    subject,
  );
}
