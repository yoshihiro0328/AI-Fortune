import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const guard = fileURLToPath(
  new URL("../payment-ci-guard.mjs", import.meta.url),
);
for (const scenario of ["credential", "env-file", "external-fetch"])
  test(`CI guard refuses ${scenario} without exposing input or opening a socket`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-ci-guard-"));
    try {
      const env = { PATH: "/usr/bin:/bin" };
      if (scenario === "credential")
        env.STRIPE_SECRET_KEY = "SYNTHETIC_PRIVATE_VALUE";
      if (scenario === "env-file")
        fs.writeFileSync(
          path.join(dir, ".env.local"),
          "SYNTHETIC_PRIVATE_VALUE",
        );
      const script =
        scenario === "external-fetch"
          ? "await fetch('https://forbidden.invalid')"
          : "process.exit(0)";
      const result = spawnSync(
        process.execPath,
        ["--import", guard, "--input-type=module", "-e", script],
        {
          cwd: dir,
          env,
          encoding: "utf8",
          timeout: 5000,
        },
      );
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /PAYMENT_CI_(EXTERNAL_FETCH_DENIED|REQUIRES_CREDENTIAL_FREE_DIRECTORY)/,
      );
      assert(!result.stderr.includes("SYNTHETIC_PRIVATE_VALUE"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
