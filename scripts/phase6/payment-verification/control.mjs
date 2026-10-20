import { insist } from "../payment-runtime/policy.mjs";
export function control({ input, stop, status, action, record, write }) {
  insist(
    input.isTTY === true && !input.destroyed && !input.readableEnded,
    "INTERACTIVE_INPUT_REQUIRED",
  );
  let pending = "",
    busy = false,
    closed = false;
  const end = () => stop("input_closed"),
    error = () => stop("input_error");
  const data = (chunk) => {
    if (closed || status().stopping) return;
    pending += chunk;
    if (pending.length > 128) return stop("invalid_input");
    let i;
    while ((i = pending.indexOf("\n")) >= 0) {
      const c = pending.slice(0, i).trim();
      pending = pending.slice(i + 1);
      if (!c) continue;
      if (c === "finish") return stop("operator_finished");
      if (c === "status") {
        const s = status();
        record("status", s);
        write(JSON.stringify(s) + "\n");
        continue;
      }
      if (
        ![
          "open-a",
          "check-a",
          "open-b",
          "check-b",
          "anonymous",
          "verify",
        ].includes(c) ||
        busy ||
        !status().ready
      )
        return stop("invalid_or_busy_command");
      busy = true;
      Promise.resolve()
        .then(() => {
          insist(!closed && !status().stopping);
          return action(c);
        })
        .then(() => {
          if (!closed) record("check_success", { operation: c });
        })
        .catch(() => stop("check_failed_or_unknown"))
        .finally(() => {
          busy = false;
        });
    }
  };
  input.setEncoding("utf8");
  input.on("end", end);
  input.on("close", end);
  input.on("error", error);
  input.on("data", data);
  return {
    close() {
      closed = true;
      pending = "";
      input.off("end", end);
      input.off("close", end);
      input.off("error", error);
      input.off("data", data);
      input.pause();
    },
  };
}
