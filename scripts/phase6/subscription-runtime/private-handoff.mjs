import fs from "node:fs";
import path from "node:path";
import { privateInput, erasePrivateInputs } from "./supervisor.mjs";
import { check } from "./policy.mjs";

// Consume the existing receiver output without displaying values or retaining a
// second plaintext copy. Never overwrite a previous attempt's assembled input.
export function assembleHandoff(root) {
  const baseFile = path.join(root, "base-credentials.json");
  const keyFile = path.join(root, "stripe-keys.json");
  const output = path.join(root, "credentials.json");
  const base = privateInput(baseFile, root);
  const keys = privateInput(keyFile, root);
  let created = false;
  try {
    check(!fs.existsSync(output), "HANDOFF_ALREADY_ASSEMBLED");
    check(
      Object.keys(base).sort().join(",") ===
        "anon,cPassword,dPassword,service,vaultKey",
    );
    check(
      Object.values(base).every(
        (value) => typeof value === "string" && value.length > 0,
      ),
    );
    check(Buffer.from(base.vaultKey, "base64").length === 32);
    check(Object.keys(keys).sort().join(",") === "app,lifecycle,listener");
    check(
      Object.values(keys).every((value) =>
        /^rk_test_[A-Za-z0-9]{24,500}$/.test(value),
      ),
    );
    check(new Set(Object.values(keys)).size === 3);
    const fd = fs.openSync(output, "wx", 0o600);
    created = true;
    try {
      fs.writeFileSync(fd, JSON.stringify({ ...base, ...keys }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    check(Object.keys(privateInput(output, root)).length === 8);
    check(
      erasePrivateInputs([baseFile, keyFile], root),
      "HANDOFF_SOURCE_ERASURE_UNCONFIRMED",
    );
    return output;
  } catch {
    if (created) erasePrivateInputs([output], root);
    throw Error("HANDOFF_FAILED_NO_RETRY");
  } finally {
    for (const object of [base, keys])
      for (const key of Object.keys(object)) object[key] = undefined;
  }
}
