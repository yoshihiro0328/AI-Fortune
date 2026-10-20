// Separately authorized read-only verification after Dashboard key expiry.
// Does NOT revoke keys, retry a price write, reset a run, or delete audit evidence.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { insist, hash, TARGET } from "./policy.mjs";
import { verifyRevoked } from "./cleanup.mjs";
export async function verifyClosure(inputFile, accountRequest) {
  const stat = fs.lstatSync(inputFile);
  insist(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  const c = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  try {
    insist(
      c.approved === true &&
        c.project === TARGET.ref &&
        c.account === TARGET.account &&
        c.keys?.length === 2,
    );
    const journalStat = fs.lstatSync(c.journal);
    insist(
      journalStat.isFile() &&
        !journalStat.isSymbolicLink() &&
        (journalStat.mode & 0o077) === 0,
    );
    const rows = fs
      .readFileSync(c.journal, "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    const before = rows.findLast((x) => x.event === "closure");
    insist(before && before.keys.length === 2);
    insist(
      c.keys.every((k) => /^rk_test_/.test(k)) && new Set(c.keys).size === 2,
    );
    insist(
      c.keys.map(hash).sort().join(",") ===
        before.keys
          .map((k) => k.fingerprint)
          .sort()
          .join(","),
    );
    // One request per key. A network error/unknown result stops; no second attempt.
    const verified = [];
    for (const key of c.keys)
      verified.push(await verifyRevoked(key, accountRequest));
    const complete =
      before.processes === "stopped" &&
      before.price === "verified_inactive" &&
      before.temporary === "deleted" &&
      verified.every((k) => k.state === "verified_revoked");
    const result = {
      event: "key_revocation_observation",
      at: new Date().toISOString(),
      keys: verified,
      complete,
    };
    const fd = fs.openSync(c.journal, "a");
    fs.writeSync(fd, JSON.stringify(result) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    return result;
  } finally {
    fs.unlinkSync(inputFile);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] !== "--approved-input" || !process.argv[3])
    process.exitCode = 1;
  else
    try {
      const result = await verifyClosure(
        path.resolve(process.argv[3]),
        async (key) => {
          const r = await fetch(TARGET.stripe + "/v1/account", {
            headers: { authorization: "Bearer " + key },
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          });
          const data = await r.json();
          return { status: r.status, code: data.error?.code };
        },
      );
      console.log(JSON.stringify(result));
      process.exitCode = result.complete ? 0 : 2;
    } catch {
      console.error("CLOSURE_UNCONFIRMED: no automatic retry");
      process.exitCode = 1;
    }
}
