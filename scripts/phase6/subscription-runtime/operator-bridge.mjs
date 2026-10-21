import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { check, TARGET } from "./policy.mjs";
import { ownerKeyWindow } from "./owner-key-window.mjs";

// Work answers these nonsecret requests using its connector or safe UI tools.
// No key/password page, clipboard, or raw response is ever requested by this bridge.
// A separate mailbox keeps the original controlling TTY alive during owner actions.
export function operatorBridge(
  root,
  { timeoutMs = 60000, ownerApproval, secretDeadline } = {},
) {
  if (ownerApproval) ownerKeyWindow(ownerApproval, secretDeadline);
  const stat = fs.lstatSync(root);
  check(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0,
  );
  check(timeoutMs > 0 && timeoutMs <= 60000);
  let serial = 0,
    closed = false;
  const files = new Set();
  const allowed = new Set([
    "price",
    "billing-read",
    "billing-write",
    "revoke-keys",
    "browser",
  ]);
  return {
    async request(kind, data = {}, signal) {
      check(!closed && allowed.has(kind), "OPERATOR_REQUEST_DENIED");
      const id = randomUUID(),
        n = ++serial;
      // Browser checkpoints include owner actions. The supervisor's same-session
      // 20-minute deadline remains authoritative; price/settings keep 60 seconds.
      if (kind === "browser")
        check(signal && !signal.aborted, "BROWSER_CONTROL_REQUIRED");
      const deadline =
        Date.now() +
        (kind === "browser"
          ? 20 * 60 * 1000
          : kind === "revoke-keys"
            ? ownerApproval
              ? ownerKeyWindow(ownerApproval, secretDeadline).uiMs
              : Math.floor((timeoutMs * 2) / 3)
            : timeoutMs);
      const request = path.join(root, `request-${n}.json`);
      const response = path.join(root, `response-${n}.json`);
      check(!fs.existsSync(response), "STALE_OPERATOR_RESPONSE");
      files.add(request);
      files.add(response);
      fs.writeFileSync(
        request,
        JSON.stringify({
          id,
          kind,
          account: TARGET.account,
          livemode: false,
          data,
          expiresAt: deadline,
          responseFile: response,
          instructions:
            "Nonsecret result only. No screen/AX/clipboard capture of keys or passwords. Never retry an uncertain mutation.",
        }),
        { flag: "wx", mode: 0o600 },
      );
      while (!closed && !signal?.aborted && Date.now() < deadline) {
        if (fs.existsSync(response)) {
          const st = fs.lstatSync(response);
          check(
            st.isFile() &&
              !st.isSymbolicLink() &&
              st.uid === process.getuid() &&
              (st.mode & 0o077) === 0 &&
              st.size < 16384,
            "INVALID_OPERATOR_RESPONSE",
          );
          const result = JSON.parse(fs.readFileSync(response, "utf8"));
          check(
            result.id === id && result.ok === true,
            "OPERATOR_FAILED_OR_UNKNOWN",
          );
          // The caller validates the specific result schema and observes API state.
          return result.value;
        }
        await delay(100, undefined, { signal });
      }
      throw Error("OPERATOR_TIMEOUT_OR_CLOSED");
    },
    close() {
      closed = true;
      for (const file of files) fs.rmSync(file, { force: true });
      return [...files].every((file) => !fs.existsSync(file));
    },
  };
}
