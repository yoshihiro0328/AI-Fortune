// Explicit local preparation only; never discovers credentials or opens a provider connection.
// Caller supplies protected, approved r5 artifacts and existing new-DB credentials.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TARGET, insist, hash, uuid } from "../payment-runtime/policy.mjs";
import { validatePaid } from "./state.mjs";
function read(file) {
  const s = fs.lstatSync(file);
  insist(
    s.isFile() &&
      !s.isSymbolicLink() &&
      (s.mode & 0o077) === 0 &&
      s.uid === process.getuid(),
  );
  return fs.readFileSync(file);
}
function decrypt(file, keyfile, sha) {
  const b = read(file);
  insist(hash(b) === sha, "BACKUP_HASH_MISMATCH");
  const key = read(keyfile);
  const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  try {
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]));
  } finally {
    key.fill(0);
  }
}
export function prepare(c) {
  insist(
    c.approved === true &&
      uuid(c.attemptId) &&
      uuid(c.previousAttemptId) &&
      c.attemptId !== c.previousAttemptId,
  );
  const stat = fs.lstatSync(c.outputDirectory);
  insist(
    stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
  );
  const manifest = decrypt(c.manifestFile, c.manifestKey, c.manifestSha256),
    observed = decrypt(c.baselineFile, c.baselineKey, c.baselineSha256),
    baseline = observed.state;
  const r5 = JSON.parse(read(c.r5ClosureFile));
  insist(
    r5.attemptId === c.previousAttemptId &&
      r5.project === TARGET.ref &&
      r5.account === TARGET.account &&
      r5.cleanup.complete === true,
    "R5_SOURCE_MISMATCH",
  );
  const p = baseline.payments[0],
    r = baseline.paid_reports[0],
    event = baseline.stripe_events[0];
  const expected = {
    payment: p.id,
    report: r.id,
    checkout: p.stripe_checkout_session_id,
    intent: p.stripe_payment_intent_id,
    event: event.stripe_event_id,
  };
  validatePaid(manifest, baseline, expected);
  const env = JSON.parse(read(c.authRuntimeFile));
  insist(env.NEXT_PUBLIC_SUPABASE_URL === TARGET.supabase);
  const database = JSON.parse(read(c.databaseInputFile));
  const file = path.join(c.outputDirectory, "continuation-input.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      approved: true,
      project: TARGET.ref,
      account: TARGET.account,
      attemptId: c.attemptId,
      previousAttemptId: c.previousAttemptId,
      fixtureDisposition: "reuse",
      manifest,
      baseline,
      expected,
      secrets: {
        anon: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        service: env.SUPABASE_SERVICE_ROLE_KEY,
      },
      database,
      sourceHashes: { manifest: c.manifestSha256, baseline: c.baselineSha256 },
    }),
    { flag: "wx", mode: 0o600 },
  );
  return { file, attemptId: c.attemptId, fixtureRegenerated: false };
}
