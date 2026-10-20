import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { listener } from "./listener.mjs";
import { TARGET } from "./policy.mjs";
test("fixed CLI hash, account, API version, private output and supervised lifetime (local fake executable)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-cli-fake-")),
    binary = path.join(dir, "fake-cli");
  fs.writeFileSync(
    binary,
    "#!/bin/sh\necho 'Ready! You are using Stripe API Version [2026-09-30.endive]. signing secret whsec_syntheticOnly'\nexec /bin/sleep 60\n",
    { mode: 0o700 },
  );
  const checksum = createHash("sha256")
    .update(fs.readFileSync(binary))
    .digest("hex");
  const options = {
    binary,
    checksum,
    key: "rk_test_syntheticOnly",
    run: randomUUID(),
    apiVersion: "2026-09-30.endive",
    readAccount: async () => ({ id: TARGET.account }),
  };
  const l = listener(options);
  try {
    await assert.rejects(
      listener({ ...options, checksum: "0".repeat(64) }).start(),
      /CLI_HASH_MISMATCH/,
    );
    await assert.rejects(
      listener({
        ...options,
        readAccount: async () => ({ id: "acct_other" }),
      }).start(),
      /ACCOUNT_MISMATCH/,
    );
    await assert.rejects(
      listener({ ...options, apiVersion: "unknown" }).start(),
      /API_VERSION_MISMATCH/,
    );
    const result = await l.start();
    assert.equal(result.account, TARGET.account);
    assert(l.alive());
    await l.stop();
    assert(!l.alive());
  } finally {
    await l.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
