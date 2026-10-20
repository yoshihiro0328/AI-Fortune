import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleHandoff } from "./private-handoff.mjs";

for (const mode of [
  "normal",
  "standard-key",
  "duplicate-key",
  "existing-output",
]) {
  test("private receiver handoff: " + mode, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-handoff-"));
    fs.chmodSync(root, 0o700);
    const write = (name, value) =>
      fs.writeFileSync(path.join(root, name), JSON.stringify(value), {
        mode: 0o600,
      });
    try {
      write("base-credentials.json", {
        anon: "synthetic-anon",
        service: "synthetic-service",
        cPassword: "synthetic-c",
        dPassword: "synthetic-d",
        vaultKey: Buffer.alloc(32, 1).toString("base64"),
      });
      const keys = Object.fromEntries(
        ["listener", "app", "lifecycle"].map((name, i) => [
          name,
          "rk_test_" + String(i).repeat(32),
        ]),
      );
      if (mode === "standard-key") keys.app = "sk_test_" + "a".repeat(32);
      if (mode === "duplicate-key") keys.app = keys.listener;
      write("stripe-keys.json", keys);
      if (mode === "existing-output")
        write("credentials.json", { retained: true });
      if (mode === "normal") {
        const output = assembleHandoff(root);
        assert.equal(fs.statSync(output).mode & 0o777, 0o600);
        assert.equal(
          Object.keys(JSON.parse(fs.readFileSync(output))).length,
          8,
        );
        assert(!fs.existsSync(path.join(root, "stripe-keys.json")));
        assert(!fs.existsSync(path.join(root, "base-credentials.json")));
        assert.throws(() => assembleHandoff(root));
      } else {
        assert.throws(() => assembleHandoff(root));
        assert(fs.existsSync(path.join(root, "stripe-keys.json")));
        if (mode === "existing-output")
          assert.deepEqual(
            JSON.parse(fs.readFileSync(path.join(root, "credentials.json"))),
            { retained: true },
          );
        else assert(!fs.existsSync(path.join(root, "credentials.json")));
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
