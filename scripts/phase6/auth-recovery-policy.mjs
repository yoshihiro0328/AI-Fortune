// Local STEP 9 harness only. No cloud configuration or application changes.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const recoveryRedirect =
  "http://localhost:5198/auth/callback?next=recovery";
export const recoveryProject = "ukdzggjfkcwjssjmnqim";
export function createRecoveryPolicy(targetLabel, recoveryUser) {
  if (
    !["a", "b"].includes(targetLabel) ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(recoveryUser)
  )
    throw new Error("Invalid recovery identity");
  const preparedStage =
    targetLabel === "b" ? "reset-prepared" : "reset-a-prepared";
  const sendStage = "reset-" + targetLabel;
  const passwordStage = "password-" + targetLabel;
  const cleanupStage = targetLabel + "-recovery-cleanup";
  const approvalFile = "reset-" + targetLabel + "-1.approved";
  const reservationFile = "reset-" + targetLabel + "-1.reserved";
  const resetStages = new Set([
    preparedStage,
    sendStage,
    passwordStage,
    cleanupStage,
  ]);
  const digest = (value) =>
    createHash("sha256").update(value).digest("base64url");

  function recoveryRequestShape(u, method, body) {
    if (u.pathname === "/auth/v1/recover")
      return (
        method === "POST" &&
        u.searchParams.size === 1 &&
        u.searchParams.get("redirect_to") === recoveryRedirect &&
        typeof body.email === "string" &&
        body.code_challenge_method === "s256" &&
        /^[A-Za-z0-9_-]{43}$/.test(body.code_challenge ?? "") &&
        Object.keys(body).every((k) =>
          [
            "email",
            "code_challenge",
            "code_challenge_method",
            "gotrue_meta_security",
          ].includes(k),
        )
      );
    if (u.pathname === "/auth/v1/user" && method === "PUT")
      return (
        !u.search &&
        Object.keys(body).every((k) =>
          ["password", "code_challenge", "code_challenge_method"].includes(k),
        ) &&
        body.code_challenge == null &&
        body.code_challenge_method == null &&
        typeof body.password === "string" &&
        body.password.length >= 12 &&
        body.password.length <= 128 &&
        /[A-Z]/.test(body.password) &&
        /[a-z]/.test(body.password) &&
        /[0-9]/.test(body.password) &&
        /[^A-Za-z0-9]/.test(body.password)
      );
    return false;
  }

  function recoveryCallbackAllowed(u, stage) {
    if (u.pathname !== "/auth/callback") return true;
    if (resetStages.has(stage))
      return (
        stage === sendStage &&
        u.searchParams.size === 2 &&
        !!u.searchParams.get("code") &&
        u.searchParams.get("next") === "recovery"
      );
    return [...u.searchParams.keys()].every((k) => k === "code");
  }

  function resetStageAllowed(u, method, stage, label, subject) {
    // Sensitive reset operations are unavailable in every other stage, too.
    if (u.pathname === "/auth/v1/recover")
      return stage === sendStage && label === targetLabel;
    if (u.pathname === "/auth/v1/user" && method === "PUT")
      return stage === passwordStage && subject === recoveryUser;
    if (
      u.pathname === "/auth/v1/logout" &&
      u.searchParams.get("scope") === "global"
    )
      return (
        [passwordStage, cleanupStage].includes(stage) &&
        subject === recoveryUser
      );
    if (!resetStages.has(stage)) return true;
    if (subject && subject !== recoveryUser) return false;
    if (stage === cleanupStage)
      return method === "GET" && u.pathname === "/auth/v1/user";
    if (method === "GET")
      return [
        "/auth/v1/user",
        "/rest/v1/diagnoses",
        "/rest/v1/service_settings",
      ].includes(u.pathname);
    if (stage === preparedStage) return false;
    if (method !== "POST") return false;
    if (u.pathname === "/rest/v1/rpc/consume_limit") return true;
    return (
      stage === sendStage &&
      u.pathname === "/auth/v1/token" &&
      u.searchParams.get("grant_type") === "pkce"
    );
  }

  // Created manually ONLY after the human's final approval. No script creates approval.
  function resetApprovalValid(dir, email, now = Date.now()) {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(dir, approvalFile)));
      return (
        a.project === recoveryProject &&
        a.user === recoveryUser &&
        a.purpose === "password-recovery" &&
        a.count === 1 &&
        a.recipientHash === digest(email) &&
        Number.isFinite(a.expiresAt) &&
        a.expiresAt > now &&
        a.expiresAt <= now + 3600000
      );
    } catch {
      return false;
    }
  }

  function reserveReset(dir, label, email, challenge) {
    if (
      label !== targetLabel ||
      !resetApprovalValid(dir, email) ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge ?? "")
    )
      throw new Error("Unapproved password recovery");
    const fd = fs.openSync(path.join(dir, reservationFile), "wx", 0o600);
    try {
      fs.writeFileSync(
        fd,
        JSON.stringify({
          label,
          user: recoveryUser,
          challenge,
          at: new Date().toISOString(),
        }),
      );
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const parent = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
  }

  function resetVerifierMatches(dir, verifier) {
    if (
      typeof verifier !== "string" ||
      verifier.length < 43 ||
      verifier.length > 128
    )
      return false;
    try {
      const record = JSON.parse(
        fs.readFileSync(path.join(dir, reservationFile)),
      );
      return (
        record.user === recoveryUser && digest(verifier) === record.challenge
      );
    } catch {
      return false;
    }
  }

  return {
    label: targetLabel,
    user: recoveryUser,
    approvalFile,
    reservationFile,
    resetStages,
    recoveryRequestShape,
    recoveryCallbackAllowed,
    resetStageAllowed,
    resetApprovalValid,
    reserveReset,
    resetVerifierMatches,
  };
}
