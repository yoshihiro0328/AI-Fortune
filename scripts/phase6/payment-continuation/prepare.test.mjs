import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { prepare } from "./prepare.mjs";
import { isolatedPaid } from "./isolated.mjs";
import { hash, TARGET } from "../payment-runtime/policy.mjs";
import { loadInput } from "./launch.mjs";
test("protected preparation decrypts exact prior fixture and purchase; no new fixture IDs, no Stripe credentials; duplicate output and changed hash rejected", async () => {
  const db = await isolatedPaid(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "continuation-prepare-test-"));
  fs.chmodSync(dir, 0o700);
  const save = (name, x) => {
    const p = path.join(dir, name);
    fs.writeFileSync(
      p,
      typeof x === "string" || Buffer.isBuffer(x) ? x : JSON.stringify(x),
      { mode: 0o600 },
    );
    return p;
  };
  const seal = (name, x) => {
    const key = crypto.randomBytes(32),
      iv = crypto.randomBytes(12),
      c = crypto.createCipheriv("aes-256-gcm", key, iv),
      cipher = Buffer.concat([c.update(JSON.stringify(x)), c.final()]),
      bytes = Buffer.concat([iv, c.getAuthTag(), cipher]);
    return {
      file: save(name, bytes),
      key: save(name + ".key", key),
      hash: hash(bytes),
    };
  };
  try {
    const m = seal("manifest", db.m),
      b = seal("baseline", { state: db.baseline }),
      previous = crypto.randomUUID();
    const jwt = (role) =>
      "e30." +
      Buffer.from(JSON.stringify({ ref: TARGET.ref, role })).toString(
        "base64url",
      ) +
      ".synthetic";
    const c = {
      approved: true,
      attemptId: crypto.randomUUID(),
      previousAttemptId: previous,
      manifestFile: m.file,
      manifestKey: m.key,
      manifestSha256: m.hash,
      baselineFile: b.file,
      baselineKey: b.key,
      baselineSha256: b.hash,
      outputDirectory: dir,
      r5ClosureFile: save("r5", {
        attemptId: previous,
        project: TARGET.ref,
        account: TARGET.account,
        cleanup: { complete: true },
      }),
      authRuntimeFile: save("auth", {
        NEXT_PUBLIC_SUPABASE_URL: TARGET.supabase,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
        SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
      }),
      databaseInputFile: save("db", {
        binary: "/test-only",
        binarySha256: "fake",
        ca: "/test-only",
        caSha256: "fake",
        password: "SyntheticOnly",
      }),
    };
    const before = hash(fs.readFileSync(m.file)),
      r = prepare(c),
      loaded = loadInput(r.file, process.cwd());
    assert.deepEqual(loaded.manifest, db.m);
    assert.deepEqual(loaded.expected, db.expected);
    assert.equal(hash(fs.readFileSync(m.file)), before);
    assert.equal(r.fixtureRegenerated, false);
    assert.equal(Object.keys(loaded.secrets).sort().join(","), "anon,service");
    assert.throws(() => prepare(c));
    assert.throws(() => prepare({ ...c, baselineSha256: "0".repeat(64) }));
  } finally {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
