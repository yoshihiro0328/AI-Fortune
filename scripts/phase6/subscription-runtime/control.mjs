import readline from "node:readline";
import { check } from "./policy.mjs";
// One TTY owns the attempt. End/close/error/timeout/signals stop it; never reconnect.
export async function control({
  input = process.stdin,
  output = process.stdout,
  alive,
  execute,
  cleanup,
  timeoutMs = 20 * 60 * 1000,
  commands = ["portal-check", "lifecycle-check"],
}) {
  check(
    input.isTTY === true && !input.destroyed && !input.readableEnded,
    "INTERACTIVE_TTY_REQUIRED",
  );
  const lines = readline.createInterface({ input, terminal: false });
  let reason = "input_closed",
    complete = false,
    stopping = false,
    statusChecked = false;
  const abort = new AbortController();
  let resolveStopped;
  const stopped = new Promise((r) => {
    resolveStopped = r;
  });
  const stop = (why) => {
    if (!stopping) {
      stopping = true;
      reason = why;
      abort.abort();
      resolveStopped(false);
      lines.close();
    }
  };
  const end = () => stop("input_closed"),
    error = () => stop("input_error"),
    interrupt = () => stop("interrupted");
  input.on("end", end);
  input.on("close", end);
  input.on("error", error);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  const health = setInterval(() => {
    if (!alive()) stop("process_failed");
  }, 250);
  try {
    output.write(`ready: status / ${commands.join(" / ")} / finish / stop\n`);
    for await (const line of lines) {
      if (stopping) break;
      check(line.length <= 80 && alive(), "CONTROL_OR_PROCESS_FAILED");
      const cmd = line.trim();
      if (cmd === "stop") {
        reason = "operator_stop";
        break;
      }
      if (cmd === "status") {
        statusChecked = true;
        output.write("status: app, CLI and broker alive\n");
        continue;
      }
      check([...commands, "finish"].includes(cmd), "CONTROL_COMMAND_DENIED");
      check(statusChecked, "STATUS_REQUIRED_BEFORE_CHECK");
      const result = await Promise.race([
        execute(cmd === "finish" ? "verify-complete" : cmd, abort.signal),
        stopped,
      ]);
      if (stopping) break;
      if (cmd === "finish") {
        check(result, "CHECKS_INCOMPLETE");
        reason = "normal";
        complete = true;
        break;
      }
      output.write("check completed\n");
    }
  } catch {
    if (!stopping) reason = "failed";
  } finally {
    clearTimeout(timer);
    clearInterval(health);
    lines.close();
    input.removeListener("end", end);
    input.removeListener("close", end);
    input.removeListener("error", error);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  const closure = await cleanup(reason);
  return {
    reason,
    complete: complete && closure.complete,
    closure,
    exitCode: complete && closure.complete ? 0 : 2,
  };
}
