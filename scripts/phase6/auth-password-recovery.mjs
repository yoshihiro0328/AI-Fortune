// Retain the original B-only interface and immutable B mail ledger names.
import { createRecoveryPolicy } from "./auth-recovery-policy.mjs";
export { recoveryProject, recoveryRedirect } from "./auth-recovery-policy.mjs";
export const recoveryUser = "9aee987e-1c44-4a96-97b5-02a58647b3bd";
export const bRecovery = createRecoveryPolicy("b", recoveryUser);
export const {
  resetStages,
  recoveryRequestShape,
  recoveryCallbackAllowed,
  resetStageAllowed,
  resetApprovalValid,
  reserveReset,
  resetVerifierMatches,
} = bRecovery;
