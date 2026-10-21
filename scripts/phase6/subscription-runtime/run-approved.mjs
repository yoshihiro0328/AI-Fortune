import path from "node:path";
import fs from "node:fs";
import { assembleHandoff } from "./private-handoff.mjs";
import { createProviderRun } from "./provider-entry.mjs";
import { privateInput, erasePrivateInputs } from "./supervisor.mjs";
import { check } from "./policy.mjs";
import { minimal } from "./minimal-profile.mjs";
import { verifyHandoffWindow } from "./receiver-session.mjs";

// Production entry. No env file, injected JS driver, arbitrary API or resume switch.
// Call with exec_command tty:true, login:true; retain returned session until exit.
const [root] = process.argv.slice(2);
try {
  check(process.argv.length === 3 && path.isAbsolute(root));
  check(
    process.stdin.isTTY === true &&
      !process.stdin.destroyed &&
      !process.stdin.readableEnded,
  );
  verifyHandoffWindow(root);
  const plan = privateInput(path.join(root, "plan.json"), root);
  check(
    Object.keys(plan).sort().join(",") ===
      "attemptId,cli,clockApproval,expected,manifest",
  );
  check(plan.manifest.synthetic === false);
  check(
    minimal(plan.manifest) && plan.clockApproval === null,
    "MINIMAL_PLAN_REQUIRED",
  );
  const credentials = path.join(root, "credentials.json");
  if (!fs.existsSync(credentials)) assembleHandoff(root);
  const run = createProviderRun({
    root,
    file: credentials,
    evidenceDirectory: path.join(root, "evidence"),
    m: plan.manifest,
    expected: plan.expected,
    attemptId: plan.attemptId,
    cli: plan.cli,
    clockApproval: plan.clockApproval,
    planFile: path.join(root, "plan.json"),
  });
  const result = await run.run();
  // No raw exceptions, manifest, keys, emails, JWTs or URLs printed.
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
  console.log("ENTRY_FAILED_OR_UNKNOWN_NO_RESTART");
  process.exitCode = 2;
}
