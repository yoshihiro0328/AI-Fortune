import fs from "node:fs";
import { createHash } from "node:crypto";
import { privateInput, erasePrivateInputs, supervisor } from "./supervisor.mjs";
import { providerWire } from "./wire.mjs";
import { vault } from "./vault.mjs";
import { listener, API_VERSION } from "./listener.mjs";
import { check } from "./policy.mjs";
import { operatorBridge } from "./operator-bridge.mjs";
import { billingSettings } from "./billing-settings.mjs";
import { sessionEvidence } from "./evidence.mjs";
import { scenario } from "./scenario.mjs";
import { minimal } from "./minimal-profile.mjs";
import { revokeAndVerify } from "./revocation.mjs";
// Programmatic entry for the existing private local receiver / same interactive TTY.
// Importing this file never reads a secret or opens a connection. No CLI/env fallback.
export function createProviderRun({
  file,
  root,
  evidenceDirectory,
  m,
  attemptId,
  cli,
  expected,
  human,
  execute,
  input = process.stdin,
  output = process.stdout,
  record = () => {},
  clockApproval,
  planFile,
  ownerApproval,
  secretDeadline,
}) {
  check(
    input.isTTY === true && !input.destroyed && !input.readableEnded,
    "INTERACTIVE_TTY_REQUIRED",
  );
  const received = privateInput(file, root);
  let key;
  try {
    check(
      Object.keys(received).sort().join(",") ===
        "anon,app,cPassword,dPassword,lifecycle,listener,service,vaultKey",
    );
    check(m.apiVersion === API_VERSION);
    key = Buffer.from(received.vaultKey, "base64");
    check(key.length === 32);
    check(
      /^[a-f0-9]{64}$/.test(cli.checksum) &&
        createHash("sha256")
          .update(fs.readFileSync(cli.binary))
          .digest("hex") === cli.checksum,
      "CLI_HASH_MISMATCH",
    );
    const store = vault(evidenceDirectory, key);
    if (planFile)
      check(
        store.save("private-plan.enc", privateInput(planFile, root)).verified,
      );
    const wire = providerWire({
      secrets: received,
      record,
      minimal: minimal(m),
    });
    let operator, billing, evidence;
    if (!execute) {
      operator = operatorBridge(root, { ownerApproval, secretDeadline });
      if (!minimal(m))
        billing = billingSettings({
          read: (signal) => operator.request("billing-read", {}, signal),
          write: (data, signal) =>
            operator.request("billing-write", data, signal),
          save: store.save,
        });
      evidence = sessionEvidence({ m, wire, save: store.save });
      execute = scenario({
        wire,
        evidence,
        operator,
        save: store.save,
        minimal: minimal(m),
      });
      human = {
        price: async (active, signal) =>
          (await operator.request("price", { id: m.price, active }, signal)) ===
          true,
        revokeKeys: () =>
          revokeAndVerify({
            revoke: (signal) =>
              operator.request("revoke-keys", { count: 3 }, signal),
            wire,
            save: store.save,
            ownerApproval,
            secretDeadline,
          }),
      };
    }
    const cliListener = listener({
      binary: cli.binary,
      checksum: cli.checksum,
      key: received.listener,
      run: m.run,
      apiVersion: m.apiVersion,
      readAccount: () =>
        wire({
          provider: "stripe",
          role: "listener",
          path: "/v1/account",
          operation: "listener_account",
        }),
    });
    const runner = supervisor({
      m,
      attemptId,
      wire,
      save: store.save,
      record,
      human,
      listener: cliListener,
      input,
      output,
      temporary: { file, root, planFile },
      execute,
      clockApproval,
      billing,
      evidence,
      afterCleanup: () => (operator ? operator.close() : true),
    });
    return {
      operations: runner.operations,
      async run() {
        try {
          return await runner.run(expected, {
            c: received.cPassword,
            d: received.dPassword,
          });
        } finally {
          for (const name of Object.keys(received)) received[name] = undefined;
          key.fill(0);
        }
      },
    };
  } catch (error) {
    erasePrivateInputs([file, ...(planFile ? [planFile] : [])], root);
    for (const name of Object.keys(received)) received[name] = undefined;
    key?.fill(0);
    throw error;
  }
}
