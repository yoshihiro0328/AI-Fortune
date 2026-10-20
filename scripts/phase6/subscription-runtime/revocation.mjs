import { check } from "./policy.mjs";
// One read per already-bound restricted key; no fallback key, no retry.
export async function verifyRevocation(wire) {
  const result = {};
  for (const role of ["listener", "app", "lifecycle"]) {
    try {
      await wire({
        provider: "stripe",
        role,
        path: "/v1/account",
        operation: "verify_key_revocation",
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
  }
  check(
    Object.values(result).every((x) => x === "revoked"),
    "KEY_REVOCATION_UNCONFIRMED",
  );
  return result;
}
