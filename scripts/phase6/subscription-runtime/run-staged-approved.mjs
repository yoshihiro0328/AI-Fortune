import fs from "node:fs";
import path from "node:path";
import { createProviderRun } from "./provider-entry.mjs";
import { privateInput, erasePrivateInputs } from "./supervisor.mjs";
import { check } from "./policy.mjs";
import { minimal } from "./minimal-profile.mjs";
import { ownerKeyWindow } from "./owner-key-window.mjs";
const [root] = process.argv.slice(2);
try {
  check(
    process.argv.length === 3 && path.isAbsolute(root) && process.stdin.isTTY,
  );
  const file = path.join(root, "base-credentials.json");
  const planFile = path.join(root, "plan.json"),
    plan = privateInput(planFile, root);
  check(
    Object.keys(plan).sort().join(",") ===
      "attemptId,cli,clockApproval,expected,manifest,ownerKeyClosure",
  );
  check(
    plan.manifest.synthetic === false &&
      minimal(plan.manifest) &&
      plan.manifest.resume &&
      plan.clockApproval === null,
  );
  check(
    !fs.existsSync(path.join(root, "credentials.json")) &&
      !fs.existsSync(path.join(root, "stripe-keys.json")),
    "NO_KEYS_BEFORE_AUTH",
  );
  // Starts earlier than Stripe receipt; therefore never extends its two-hour limit.
  const secretDeadline = Date.now() + 7200000;
  ownerKeyWindow(plan.ownerKeyClosure, secretDeadline);
  const run = createProviderRun({
    root,
    file,
    planFile,
    m: plan.manifest,
    evidenceDirectory: path.join(root, "evidence"),
    expected: plan.expected,
    attemptId: plan.attemptId,
    cli: plan.cli,
    clockApproval: null,
    ownerApproval: plan.ownerKeyClosure,
    secretDeadline,
    staged: true,
  });
  const result = await run.run();
  console.log(
    JSON.stringify({
      event: "closed",
      testComplete: result.complete,
      cleanupComplete: result.closure?.complete === true,
      exitCode: result.exitCode,
    }),
  );
  process.exitCode = result.exitCode;
} catch {
  if (typeof root === "string" && path.isAbsolute(root)) {
    const files = [
      "base-credentials.json",
      "stripe-keys.json",
      "credentials.json",
      "plan.json",
    ]
      .map((n) => path.join(root, n))
      .filter((p) => fs.existsSync(p));
    console.log(
      JSON.stringify({ prestartErased: erasePrivateInputs(files, root) }),
    );
  }
  console.log("STAGED_ENTRY_FAILED_NO_RESTART");
  process.exitCode = 2;
}
