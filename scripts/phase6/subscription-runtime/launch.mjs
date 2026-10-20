import { preflight } from "./journal.mjs";
import { control } from "./control.mjs";
import { startRuntime, closeAttempt } from "./runtime.mjs";
import { check } from "./policy.mjs";
import { API_VERSION } from "./listener.mjs";
// One supervisor for the scoped scenario, never the old subscription-live suite.
// Provider provisioning/key issuance are explicit operator steps before this entry.
// Adapters must implement bounded, scoped operations; no fallback credentials or env loading.
export async function runPreparedAttempt({
  m,
  expected,
  read,
  transport,
  listener,
  execute,
  cleanup,
  record = () => {},
  input = process.stdin,
  output = process.stdout,
  timeoutMs,
  runtimeFactory = startRuntime,
}) {
  let runtime, received, closure;
  const close = async () => {
    if (closure) return closure;
    closure = await closeAttempt({
      ...cleanup,
      stopProcesses: async () => {
        // An app stop failure must not skip stopping the listener.
        const results = await Promise.allSettled([
          runtime?.stop(),
          listener.stop(),
        ]);
        return (
          results.every((r) => r.status === "fulfilled") &&
          !listener.alive() &&
          (!runtime || !runtime.alive())
        );
      },
    });
    return closure;
  };
  try {
    check(
      input.isTTY === true && !input.readableEnded && !input.destroyed,
      "INTERACTIVE_TTY_REQUIRED",
    );
    check(m.apiVersion === API_VERSION, "API_VERSION_MISMATCH");
    await preflight(m, read, expected);
    received = await listener.start(); // self-only six-event listener; no simulated provider trigger
    check(
      received.account === m.account &&
        received.apiVersion === m.apiVersion &&
        listener.alive(),
      "LISTENER_MISMATCH",
    );
    runtime = await runtimeFactory({
      m,
      transport,
      webhookSecret: received.secret,
      record,
    });
    check(runtime.alive() && listener.alive(), "NOT_READY");
    const result = await control({
      input,
      output,
      timeoutMs,
      alive: () => runtime.alive() && listener.alive(),
      execute: (command, signal) => execute(command, { runtime, signal }),
      cleanup: close,
    });
    record({
      event: "finished",
      complete: result.complete,
      exitCode: result.exitCode,
    });
    return result;
  } catch {
    const closure = await close();
    record({ event: "startup_failed", complete: false, exitCode: 2 });
    return { complete: false, exitCode: 2, reason: "startup_failed", closure };
  } finally {
    received = undefined;
  }
}
