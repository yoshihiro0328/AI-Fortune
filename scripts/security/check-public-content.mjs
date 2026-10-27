// Read-only, value-suppressing scan. A clean pattern scan is not proof of absence.
import { execFileSync } from "node:child_process";
const ref = process.argv[2] || "HEAD";
if (!/^[A-Za-z0-9_./-]+$/.test(ref) || ref.startsWith("-"))
  throw Error("INVALID_REF");
const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
const patterns = [
  ["provider_secret", /(?:sk-proj-|sk-svcacct-)[A-Za-z0-9_-]{30,}/g],
  ["payment_secret", /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/g],
  ["webhook_secret", /whsec_[A-Za-z0-9]{24,}/g],
  ["access_token", /(?:sb_secret_|sbp_|ghp_|github_pat_)[A-Za-z0-9_-]{30,}/g],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  [
    "jwt_candidate",
    /eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{20,}/g,
  ],
  [
    "temporary_portal_url",
    /https:\/\/billing\.stripe\.com\/[^\s"'<>]+(?:secret=|bps_)[^\s"'<>]+/g,
  ],
  [
    "credential_url",
    /(?:postgres(?:ql)?|https?):\/\/[^\s/:]+:[^\s/@]+@[^\s]+/g,
  ],
];
const names = git(["ls-tree", "-r", "--name-only", ref])
  .trim()
  .split("\n")
  .filter(Boolean);
let scanned = 0;
const findings = [];
for (const name of names) {
  if (
    !/\.(?:ts|tsx|js|mjs|json|md|sql|ya?ml|toml|txt|example|py|sh)$/.test(name)
  )
    continue;
  const source = git(["show", `${ref}:${name}`]);
  scanned++;
  for (const [rule, pattern] of patterns) {
    pattern.lastIndex = 0;
    const matches = [...source.matchAll(pattern)].filter(
      (m) => !/(?:fixture|synthetic|example|placeholder|test-only)/i.test(m[0]),
    );
    if (matches.length)
      findings.push({ path: name, rule, count: matches.length });
  }
}
console.log(
  JSON.stringify({
    ref,
    scannedFiles: scanned,
    findings,
    valuesPrinted: false,
    scope: "tracked snapshot only; not remote history or tool outputs",
  }),
);
process.exitCode = findings.length ? 1 : 0;
