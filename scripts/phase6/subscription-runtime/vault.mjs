import fs from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { check } from "./policy.mjs";
export function vault(directory, key) {
  check(Buffer.isBuffer(key) && key.length === 32, "VAULT_KEY_REQUIRED");
  const stat = fs.lstatSync(directory);
  check(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      !(stat.mode & 0o077) &&
      stat.uid === process.getuid(),
    "PRIVATE_VAULT_REQUIRED",
  );
  return {
    save(name, value) {
      check(/^[a-z0-9-]+\.enc$/.test(name));
      const plain = Buffer.from(JSON.stringify(value)),
        iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([c.update(plain), c.final()]);
      const file = path.join(directory, name);
      const fd = fs.openSync(file, "wx", 0o600);
      try {
        fs.writeFileSync(fd, Buffer.concat([iv, c.getAuthTag(), encrypted]));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const raw = fs.readFileSync(file),
        d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      const restored = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
      check(restored.equals(plain), "BACKUP_VERIFY_FAILED");
      return {
        verified: true,
        sha256: createHash("sha256").update(raw).digest("hex"),
      };
    },
  };
}
