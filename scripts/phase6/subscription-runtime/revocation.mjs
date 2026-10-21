import { check } from "./policy.mjs";
import { ownerKeyWindow } from "./owner-key-window.mjs";
// One read per already-bound restricted key; no fallback key, no retry.
export async function verifyRevocation(
  wire,
  { signal, record = () => {} } = {},
) {
  const result = {};
  await Promise.all(
    ["listener", "app", "lifecycle"].map(async (role) => {
      try {
        await wire({
          provider: "stripe",
          role,
          path: "/v1/account",
          operation: "verify_key_revocation",
          signal,
        });
        result[role] = "still_valid";
      } catch (error) {
        result[role] =
          error.httpStatus === 401 &&
          ["api_key_expired", "api_key_invalid", "invalid_api_key"].includes(
            error.message,
          )
            ? "revoked"
            : "unknown";
      }
    }),
  );
  record(result);
  check(
    Object.values(result).every((x) => x === "revoked"),
    "KEY_REVOCATION_UNCONFIRMED",
  );
  return result;
}

// Legacy closure: UI <=40s, reads <=15s, erasure >=5s. An explicitly approved
// owner-only window changes UI waiting alone, capped by the secret deadline.
export async function revokeAndVerify({
  revoke,
  wire,
  save,
  timeoutMs = 60000,
  ownerApproval,
  secretDeadline,
}) {
  check(Number.isInteger(timeoutMs) && timeoutMs >= 60 && timeoutMs <= 60000);
  const uiMs = ownerApproval
    ? ownerKeyWindow(ownerApproval, secretDeadline).uiMs
    : Math.floor((timeoutMs * 2) / 3);
  const bounded = async (ms, action) => {
    const abort = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(Error("KEY_CLOSURE_DEADLINE"));
      }, ms);
    });
    try {
      return await Promise.race([action(abort.signal), expired]);
    } finally {
      clearTimeout(timer);
    }
  };
  const evidence = { ui: "unconfirmed", api: {}, apiComplete: false };
  try {
    try {
      if (uiMs > 0 && (await bounded(uiMs, revoke)) === true)
        evidence.ui = "confirmed";
    } catch {
      /* A partial UI result still permits one read per existing key. */
    }
    const readMs = ownerApproval
      ? ownerKeyWindow(ownerApproval, secretDeadline).readMs
      : Math.floor(timeoutMs / 4);
    check(readMs > 0, "SECRET_DEADLINE_REQUIRES_ERASURE");
    await bounded(readMs, (signal) =>
      verifyRevocation(wire, {
        signal,
        record: (result) => {
          evidence.api = { ...result };
        },
      }),
    );
    evidence.apiComplete = true;
    return true;
  } finally {
    check(save("key-revocation.enc", evidence).verified);
  }
}
