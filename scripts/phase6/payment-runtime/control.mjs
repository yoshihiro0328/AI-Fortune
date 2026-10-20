import { insist } from "./policy.mjs";

// A terminal is part of the execution contract. Never detach, keep stdin open
// artificially, ignore EOF, or echo arbitrary input into an audit log.
export function bindControl({ input, stop, record, status, action, write }) {
  insist(input.isTTY === true, "INTERACTIVE_INPUT_REQUIRED");
  insist(
    !input.destroyed && !input.readableEnded && input.readable !== false,
    "CONTROL_INPUT_CLOSED",
  );
  let pending = "",
    disposed = false,
    busy = false;
  const end = () => stop("input_closed");
  const error = () => stop("input_error");
  const data = (chunk) => {
    if (disposed || status().stopping) return;
    pending += chunk;
    if (pending.length > 128) {
      pending = "";
      stop("invalid_control_input");
      return;
    }
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const command = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!command) continue;
      if (command === "finish") {
        stop("operator_finished");
        return;
      }
      if (command === "status") {
        const snapshot = status();
        record("control_status", snapshot);
        write(JSON.stringify({ event: "control_status", ...snapshot }) + "\n");
        continue;
      }
      if (!["duplicate", "rls"].includes(command)) {
        stop("invalid_control_input");
        return;
      }
      if (!status().ready || busy) {
        stop("control_not_ready");
        return;
      }
      busy = true;
      Promise.resolve()
        .then(() => {
          insist(!disposed && !status().stopping, "RUNTIME_STOPPING");
          return action(command);
        })
        .then(() => {
          if (!disposed) record("operator_check_success", { check: command });
        })
        .catch(() => {
          if (!disposed) stop("operator_check_failed");
        })
        .finally(() => {
          busy = false;
        });
    }
  };
  input.setEncoding("utf8");
  input.on("end", end);
  input.on("close", end);
  input.on("error", error);
  input.on("data", data); // Start watching before any provider preflight.
  record("control_attached", { tty: true });
  return {
    close() {
      disposed = true;
      pending = "";
      input.removeListener("data", data);
      input.removeListener("end", end);
      input.removeListener("close", end);
      input.removeListener("error", error);
      input.pause();
    },
  };
}
