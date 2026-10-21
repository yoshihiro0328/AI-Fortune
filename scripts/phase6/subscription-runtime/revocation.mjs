import { check } from "./policy.mjs";
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

// Within the existing 60-second closure slot: UI <=40s, concurrent reads <=15s,
// leave >=5s for local erasure. No new key, mutation retry, or lifetime extension.
export async function revokeAndVerify({
  revoke,
  wire,
  save,
  timeoutMs = 60000,
}) {
  check(Number.isInteger(timeoutMs) && timeoutMs >= 60 && timeoutMs <= 60000);
  const uiMs = Math.floor((timeoutMs * 2) / 3);
  const readMs = Math.floor(timeoutMs / 4);
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
      if ((await bounded(uiMs, revoke)) === true) evidence.ui = "confirmed";
    } catch {
      /* A partial UI result still permits one read per existing key. */
    }
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
