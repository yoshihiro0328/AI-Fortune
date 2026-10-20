import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TARGET, insist, hash, uuid } from "../payment-runtime/policy.mjs";
import { validatePaid, reportBody } from "../payment-continuation/state.mjs";
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
  insist(hash(b) === sha, "SOURCE_HASH_MISMATCH");
  const k = read(keyfile),
    d = crypto.createDecipheriv("aes-256-gcm", k, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  try {
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]));
  } finally {
    k.fill(0);
  }
}
export function prepare(c) {
  insist(
    c.approved === true &&
      uuid(c.attemptId) &&
      uuid(c.previousAttemptId) &&
      c.attemptId !== c.previousAttemptId,
  );
  const s = fs.lstatSync(c.outputDirectory);
  insist(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o077) === 0);
  const m = decrypt(c.manifestFile, c.manifestKey, c.manifestSha256),
    observed = decrypt(c.baselineFile, c.baselineKey, c.baselineSha256),
    baseline = observed.state,
    rateBaseline = observed.rate_limits;
  insist(Array.isArray(rateBaseline));
  const p = baseline.payments[0],
    r = baseline.paid_reports[0],
    e = baseline.stripe_events[0];
  const expected = {
    payment: p.id,
    report: r.id,
    checkout: p.stripe_checkout_session_id,
    intent: p.stripe_payment_intent_id,
    event: e.stripe_event_id,
  };
  validatePaid(m, baseline, expected, reportBody(c.repo));
  const env = JSON.parse(read(c.authRuntimeFile));
  insist(env.NEXT_PUBLIC_SUPABASE_URL === TARGET.supabase);
  const file = path.join(c.outputDirectory, "verification-input.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      approved: true,
      project: TARGET.ref,
      account: TARGET.account,
      fixtureDisposition: "reuse",
      attemptId: c.attemptId,
      previousAttemptId: c.previousAttemptId,
      manifest: m,
      baseline,
      rateBaseline,
      expected,
      secrets: {
        anon: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        service: env.SUPABASE_SERVICE_ROLE_KEY,
      },
      sourceHashes: { manifest: c.manifestSha256, baseline: c.baselineSha256 },
    }),
    { flag: "wx", mode: 0o600 },
  );
  return {
    file,
    attemptId: c.attemptId,
    fixtureRegenerated: false,
    databasePassword: false,
  };
}
