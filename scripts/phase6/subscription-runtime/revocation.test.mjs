import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyRevocation } from "./revocation.mjs";
for (const mode of ["revoked", "still-valid", "timeout", "forbidden"]) {
  test(
    "revocation must observe invalid keys, not any error: " + mode,
    async () => {
      const calls = [];
      const promise = verifyRevocation(async (req) => {
        calls.push(req);
        if (req.role === "app" && mode === "still-valid")
          return { id: "acct_synthetic" };
        const code =
          req.role !== "app" || mode === "revoked"
            ? "api_key_expired"
            : mode === "timeout"
              ? "TIMEOUT_OR_ABORT"
              : "permission_missing";
        throw Object.assign(Error(code), {
          httpStatus:
            code === "api_key_expired"
              ? 401
              : mode === "forbidden"
                ? 403
                : null,
        });
      });
      if (mode === "revoked") assert.equal((await promise).app, "revoked");
      else await assert.rejects(promise, /UNCONFIRMED/);
      assert.deepEqual(
        calls.map((x) => x.role),
        ["listener", "app", "lifecycle"],
      );
      assert(calls.every((x) => x.path === "/v1/account"));
    },
  );
}
