import fs from "node:fs";
import path from "node:path";
import { keyReceiver } from "./key-receiver.mjs";
import { erasePrivateInputs, privateInput } from "./supervisor.mjs";
import { check } from "./policy.mjs";

export const SECRET_WINDOW_MS = 2 * 60 * 60 * 1000;
export const START_RESERVE_MS = 30 * 60 * 1000;
export function verifyHandoffWindow(directory, now = Date.now()) {
  const receipt = privateInput(
    path.join(directory, "receipt-window.json"),
    directory,
  );
  const closed = privateInput(
    path.join(directory, "receiver-closed.json"),
    directory,
  );
  check(
    closed.reason === "handoff" &&
      Number.isSafeInteger(receipt.deadline) &&
      receipt.deadline - now >= START_RESERVE_MS &&
      receipt.deadline - now <= SECRET_WINDOW_MS,
    "FRESH_HANDOFF_REQUIRED",
  );
}
// Owner confirmation may take arbitrarily long BEFORE any submission. The first
// POST starts the original two-hour ceiling; invalid/repeated POSTs never reset it.
export async function receiverSession({
  directory,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  onClosed = () => {},
}) {
  check(
    !fs.existsSync(path.join(directory, "receiver-closed.json")),
    "CLOSED_ATTEMPT",
  );
  check(
    !fs.existsSync(path.join(directory, "receipt-window.json")),
    "USED_ATTEMPT",
  );
  let deadline = null,
    timer,
    closing,
    closed = false;
  const receiver = await keyReceiver({
    directory,
    onSubmission() {
      check(
        !closed && (deadline === null || now() < deadline),
        "RECEIVER_EXPIRED",
      );
      if (deadline !== null) return;
      deadline = now() + SECRET_WINDOW_MS;
      timer = schedule(() => close("timeout"), SECRET_WINDOW_MS);
      fs.writeFileSync(
        path.join(directory, "receipt-window.json"),
        JSON.stringify({ deadline }),
        { mode: 0o600, flag: "wx" },
      );
    },
  });
  function status() {
    return {
      ...receiver.status(),
      closed,
      phase: closed
        ? "closed"
        : deadline === null
          ? "awaiting_owner"
          : "secret_window",
      remainingMs:
        deadline === null ? SECRET_WINDOW_MS : Math.max(0, deadline - now()),
      ownerWaitExpires: false,
    };
  }
  async function close(reason) {
    if (closing) return closing;
    // Set before awaiting: no submission or handoff may race a shutdown.
    closed = true;
    closing = (async () => {
      cancel(timer);
      await receiver.close();
      const erase = reason !== "handoff";
      const files = [
        "base-credentials.json",
        "plan.json",
        "stripe-keys.json",
        "credentials.json",
      ]
        .map((n) => path.join(directory, n))
        .filter((p) => fs.existsSync(p));
      const erased = erase ? erasePrivateInputs(files, directory) : false;
      const result = { reason, erased, ...status() };
      fs.writeFileSync(
        path.join(directory, "receiver-closed.json"),
        JSON.stringify(result),
        { mode: 0o600, flag: "wx" },
      );
      onClosed(result);
      return result;
    })();
    return closing;
  }
  return {
    url: receiver.url,
    status,
    close,
    async beforeCreate() {
      check(
        !closed && !receiver.status().received && !receiver.status().failed,
      );
      check(
        status().remainingMs >= START_RESERVE_MS,
        "INSUFFICIENT_SECRET_WINDOW",
      );
      const response = await fetch(receiver.url, {
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      await response.body?.cancel();
      check(
        response.status === 200 &&
          !closed &&
          !receiver.status().received &&
          !receiver.status().failed &&
          status().remainingMs >= START_RESERVE_MS,
        "RECEIVER_NOT_READY",
      );
      return { ready: true, ...status() };
    },
    async handoff() {
      check(!closed && receiver.status().received && !receiver.status().failed);
      check(
        status().remainingMs >= START_RESERVE_MS,
        "INSUFFICIENT_START_RESERVE",
      );
      return close("handoff");
    },
  };
}
