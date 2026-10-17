/** Offline compiler and immutable artifact reader. No hosted transport or credentials. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { insertSQL, validatePlan, tables } from "./step10-fixtures.mjs";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function completeSQL(plan, profileFingerprint) {
  const p = validatePlan(plan);
  if (!/^[a-f0-9]{32}$/.test(profileFingerprint))
    throw Error("Invalid baseline fingerprint");
  const empty = [
    ...tables,
    "payments",
    "subscriptions",
    "billing_customers",
    "ai_calls",
    "consultation_ai_calls",
  ];
  const checks = empty.map(
    (t) =>
      `if exists(select 1 from public.${t}) then raise exception 'Nonempty business table'; end if;`,
  );
  checks.push(
    `if (select count(*) from auth.users)<>2 or (select count(*) from auth.users where id in ('${p.users.join("','")}') and email_confirmed_at is not null)<>2 or (select count(*) from public.profiles)<>2 then raise exception 'Identity mismatch'; end if;`,
  );
  checks.push(
    `if (select count(*) from supabase_migrations.schema_migrations)<>17 or exists(select 1 from public.price_versions where active) or exists(select 1 from trial_private.settings where enabled) then raise exception 'Safety state mismatch'; end if;`,
  );
  checks.push(
    `if not exists(select 1 from public.payment_environment where mode='sandbox' and stripe_account_id='acct_1UQlQdI73kTcvXz8') then raise exception 'Payment target mismatch'; end if;`,
  );
  checks.push(
    `if (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'')) from public.profiles p)<>'${profileFingerprint}' then raise exception 'Profile changed'; end if;`,
  );
  checks.push(
    `if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','trial_private') and c.relkind='r' and not c.relrowsecurity) then raise exception 'RLS mismatch'; end if;`,
  );
  const preamble = `begin;\nset local lock_timeout='3s';\nlock table ${empty.map((t) => "public." + t).join(",")} in share row exclusive mode;\ndo $$ begin\n${checks.join("\n")}\nend $$;`;
  // A callback returns literal text: String.replace's $$/$&/$`/$' expansion cannot run.
  return insertSQL(p).replace(/^begin;/, () => preamble);
}
export function saveArtifact(
  directory,
  { plan, profileFingerprint, profiles, previousAttemptSha256 },
) {
  validatePlan(plan);
  if (!/^[a-f0-9]{64}$/.test(previousAttemptSha256))
    throw Error("Previous attempt required");
  fs.mkdirSync(directory, { mode: 0o700 }); // Never overwrite or reuse a prepared attempt.
  const sql = Buffer.from(completeSQL(plan, profileFingerprint));
  const metadata = {
    version: 1,
    project: plan.project,
    state: "prepared-not-authorized",
    sqlSha256: sha256(sql),
    manifestSha256: sha256(JSON.stringify(plan)),
    previousAttemptSha256,
  };
  for (const [name, bytes] of Object.entries({
    "complete.sql": sql,
    "manifest.json": JSON.stringify(plan),
    "baseline.json": JSON.stringify({ profileFingerprint, profiles }),
    "attempt.json": JSON.stringify(metadata),
  }))
    fs.writeFileSync(path.join(directory, name), bytes, {
      flag: "wx",
      mode: 0o400,
    });
  return metadata;
}
/** Future transmission must read these exact bytes, not invoke the compiler again. */
export function verifiedBytes(directory, expectedSha256) {
  const m = JSON.parse(fs.readFileSync(path.join(directory, "attempt.json")));
  const certificate = JSON.parse(
    fs.readFileSync(path.join(directory, "verification.json")),
  );
  const bytes = fs.readFileSync(path.join(directory, "complete.sql"));
  const plan = validatePlan(
    JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"))),
  );
  if (
    m.project !== plan.project ||
    sha256(JSON.stringify(plan)) !== m.manifestSha256 ||
    sha256(bytes) !== expectedSha256 ||
    m.sqlSha256 !== expectedSha256 ||
    certificate.sqlSha256 !== expectedSha256 ||
    certificate.success !== true ||
    certificate.mode !== "preserved-artifact" ||
    certificate.hostedWrites !== 0
  )
    throw Error("Artifact verification mismatch");
  return bytes;
}
