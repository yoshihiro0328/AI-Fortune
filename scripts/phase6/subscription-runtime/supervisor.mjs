import fs from "node:fs";
import path from "node:path";
import { check, TARGET } from "./policy.mjs";
import { providerOperations } from "./provider-ops.mjs";
import { appTransport } from "./app-transport.mjs";
import { observePreflight } from "./journal.mjs";
import { runPreparedAttempt } from "./launch.mjs";
import { closeAttempt } from "./runtime.mjs";
import { workLogin } from "./work-login.mjs";
import { minimal } from "./minimal-profile.mjs";
// Transport, vault and human controls are injected once before any operation. The
// production adapter and loopback adapter use the identical sender and supervisor.
// No .env fallback, shell, arbitrary SQL, recovery/restart or credential-screen access.
export function privateInput(file, root) {
  const dir = fs.lstatSync(root),
    st = fs.lstatSync(file);
  check(
    dir.isDirectory() &&
      !dir.isSymbolicLink() &&
      dir.uid === process.getuid() &&
      (dir.mode & 0o077) === 0,
  );
  check(
    st.isFile() &&
      !st.isSymbolicLink() &&
      (st.mode & 0o077) === 0 &&
      st.uid === process.getuid(),
  );
  check(
    path.dirname(fs.realpathSync(file)) === fs.realpathSync(root),
    "PRIVATE_FILE_REQUIRED",
  );
  check(st.size > 0 && st.size < 65536);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function erasePrivateInputs(files, root) {
  let complete = true;
  for (const file of files) {
    try {
      privateInput(file, root);
      fs.unlinkSync(file);
      check(!fs.existsSync(file));
    } catch {
      complete = false;
    }
  }
  return complete;
}
export function supervisor({
  m,
  attemptId,
  wire,
  save,
  record = () => {},
  human,
  listener,
  input,
  output,
  temporary,
  execute,
  runtimeFactory,
  timeoutMs,
  clockApproval,
  billing,
  evidence,
  afterCleanup = () => true,
}) {
  check(typeof wire.settle === "function" && typeof execute === "function");
  const abort = new AbortController();
  const ops = providerOperations({
    m,
    attemptId,
    wire,
    save,
    record,
    human,
    signal: abort.signal,
    clockApproval,
  });
  let started = false,
    providerClosure,
    closure,
    prepared;
  const read = (p) =>
    wire({
      provider: "supabase",
      role: "service",
      path: "/rest/v1/" + p,
      operation: "runtime_preflight",
      signal: abort.signal,
    });
  const providerClose = async () => {
    if (!providerClosure)
      providerClosure = (async () => {
        ops.stop();
        abort.abort();
        await wire.settle();
        return ops.cleanup();
      })();
    return providerClosure;
  };
  const cleanup = {
    endContracts: async () =>
      (await providerClose()).endContracts === "verified",
    deactivatePrice: async () =>
      (await providerClose()).deactivatePrice === "verified",
    restorePortalBinding: async () =>
      (await providerClose()).restorePortalBinding === "verified",
    ...(billing
      ? {
          restoreBillingSettings: async () => {
            const p = await providerClose();
            const restored = await billing.restore(
              p.endContracts === "verified" && p.invoiceSafety === "verified",
            );
            check(save("billing-restoration.enc", restored).verified);
            return restored.complete;
          },
        }
      : {}),
    eraseTemporary: async () => {
      // Only a caller-validated private input file, never an arbitrary directory tree.
      const erased = erasePrivateInputs(
        [temporary.file, ...(temporary.planFile ? [temporary.planFile] : [])],
        temporary.root,
      );
      evidence?.erase();
      return erased;
    },
    verifyRestoration: async () => {
      const p = await providerClose();
      await ops.inspectAfter();
      return p.complete;
    },
    revokeKeys: async () => human.revokeKeys(),
  };
  const finish = (result) => {
    try {
      check(afterCleanup());
    } catch {
      result.complete = false;
      result.exitCode = 2;
      result.operatorCleanup = "failed";
      result.closure.complete = false;
    }
    try {
      check(save("completion.enc", result).verified);
    } catch {
      result.complete = false;
      result.exitCode = 2;
      result.recording = "failed";
    }
    try {
      record({
        event: "provider_finished",
        complete: result.complete,
        exitCode: result.exitCode,
      });
    } catch {
      result.complete = false;
      result.exitCode = 2;
      result.recording = "failed";
    }
    return result;
  };
  return {
    // Called only by the single bounded scenario driver; changes are individually
    // reserved and validated by ops, and unknown results latch STOP.
    operations: ops,
    async run(expected, passwords) {
      let login;
      check(!started, "ATTEMPT_ALREADY_STARTED");
      started = true;
      const stop = () => {
        ops.stop();
        abort.abort();
      };
      const budget = timeoutMs ?? 20 * 60 * 1000;
      check(budget > 0 && budget <= 20 * 60 * 1000);
      const start = Date.now(),
        timer = setTimeout(stop, budget);
      input.on("end", stop);
      input.on("close", stop);
      input.on("error", stop);
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      try {
        check(
          input.isTTY === true && !input.destroyed && !input.readableEnded,
          "INTERACTIVE_TTY_REQUIRED",
        );
        await ops.inspect(expected);
        if (billing) await billing.prepare(abort.signal);
        prepared = await ops.prepare(passwords);
        if (minimal(prepared)) login = workLogin(prepared, passwords);
        const expectedPrepared = await observePreflight(prepared, read);
        check(save("prepared.enc", expectedPrepared).verified);
        const result = await runPreparedAttempt({
          m: prepared,
          expected: expectedPrepared,
          read,
          transport: appTransport({
            wire,
            operations: ops,
            signal: abort.signal,
            login,
          }),
          listener,
          reserve: ops.reserveRuntime,
          beforeClose: stop,
          record: (entry) =>
            record(
              entry.event === "finished"
                ? { ...entry, event: "control_finished" }
                : entry,
            ),
          input,
          output,
          timeoutMs: Math.max(1, budget - (Date.now() - start)),
          runtimeFactory,
          evidence,
          execute: Object.assign(
            async (command, context) =>
              execute(command, { ...context, operations: ops, m: prepared }),
            { commands: execute.commands },
          ),
          cleanup,
        });
        closure = result.closure;
        if (providerClosure) {
          const p = await providerClosure;
          if (!p.complete) {
            result.complete = false;
            result.exitCode = 2;
            result.closure.complete = false;
            result.closure.unresolvedOperations = p.unresolvedOperations;
          }
        }
        return finish(result);
      } catch {
        closure = await closeAttempt({
          ...cleanup,
          stopProcesses: async () => {
            await listener.stop();
            return !listener.alive();
          },
        });
        if (providerClosure) {
          try {
            const p = await providerClosure;
            if (!p.complete) {
              closure.complete = false;
              closure.unresolvedOperations = p.unresolvedOperations;
            }
          } catch {
            closure.complete = false;
          }
        }
        return finish({
          complete: false,
          exitCode: 2,
          reason: "preparation_failed",
          closure,
        });
      } finally {
        login?.close();
        passwords = undefined;
        clearTimeout(timer);
        input.removeListener("end", stop);
        input.removeListener("close", stop);
        input.removeListener("error", stop);
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    },
    target: TARGET,
  };
}
