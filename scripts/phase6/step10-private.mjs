import fs from "node:fs";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
export const read = (d, n) => JSON.parse(fs.readFileSync(path.join(d, n)));
export function seal(d, n, value) {
  const key = fs.readFileSync(path.join(d, "encryption.key")),
    iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  fs.writeFileSync(path.join(d, n), Buffer.concat([iv, c.getAuthTag(), data]), {
    mode: 0o600,
    flag: "wx",
  });
}
export function unseal(d, n) {
  const key = fs.readFileSync(path.join(d, "encryption.key")),
    data = fs.readFileSync(path.join(d, n));
  const c = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  c.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([c.update(data.subarray(28)), c.final()]));
}
export function stop(d, reason) {
  fs.writeFileSync(path.join(d, "STOP"), reason, { mode: 0o600 });
}
