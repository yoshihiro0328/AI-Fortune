import path from "node:path";
import fs from "node:fs";
import { assembleHandoff } from "./private-handoff.mjs";
import { createProviderRun } from "./provider-entry.mjs";
import { privateInput } from "./supervisor.mjs";
import { check } from "./policy.mjs";

// Production entry. No env file, injected JS driver, arbitrary API or resume switch.
// Call with exec_command tty:true, login:true; retain returned session until exit.
try {
  const [root] = process.argv.slice(2);
  check(process.argv.length === 3 && path.isAbsolute(root));
  check(
    process.stdin.isTTY === true &&
      !process.stdin.destroyed &&
      !process.stdin.readableEnded,
  );
  const plan = privateInput(path.join(root, "plan.json"), root);
  check(
    Object.keys(plan).sort().join(",") ===
      "attemptId,cli,clockApproval,expected,manifest",
  );
  check(plan.manifest.synthetic === false);
  check(
    plan.clockApproval?.limit === 5 && plan.clockApproval.explicit === true,
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
  console.log("ENTRY_FAILED_OR_UNKNOWN_NO_RESTART");
  process.exitCode = 2;
}
