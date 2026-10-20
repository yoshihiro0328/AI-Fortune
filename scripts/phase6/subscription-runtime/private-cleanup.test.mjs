import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { erasePrivateInputs } from "./supervisor.mjs";

test("private cleanup continues after one invalid input without following symlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-private-"));
  fs.chmodSync(root, 0o700);
  try {
    const protectedFile = path.join(root, "protected.json");
    const invalid = path.join(root, "credentials.json");
    const plan = path.join(root, "plan.json");
    fs.writeFileSync(protectedFile, "{}", { mode: 0o600 });
    fs.symlinkSync(protectedFile, invalid);
    fs.writeFileSync(plan, "{}", { mode: 0o600 });
    assert.equal(erasePrivateInputs([invalid, plan], root), false);
    assert(fs.existsSync(protectedFile));
    assert(!fs.existsSync(plan));
    assert.equal(erasePrivateInputs([protectedFile], root), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
