import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { receiverSession } from "./receiver-session.mjs";
import { privateInput } from "./supervisor.mjs";
import { check } from "./policy.mjs";

// Entered only after both actual logins. Owner waiting consumes the SAME 20 min.
export async function stagedKeyHandoff({
  root,
  input,
  output,
  signal,
  deadline,
  received,
}) {
  check(
    !signal.aborted && deadline - Date.now() >= 8 * 60 * 1000,
    "KEY_CREATION_TIME_REQUIRED",
  );
  const receiver = await receiverSession({ directory: root });
  fs.writeFileSync(
    path.join(root, "input-ui.json"),
    JSON.stringify({ url: receiver.url }),
    { flag: "wx", mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(root, "key-stage.json"),
    JSON.stringify({ ready: true, deadline }),
    { flag: "wx", mode: 0o600 },
  );
  const lines = readline.createInterface({ input, terminal: false });
  let handed = false;
  const stop = () => {
    lines.close();
    void receiver.close("staged_interrupted");
  };
  signal.addEventListener("abort", stop, { once: true });
  output.write(
    "AUTH_VERIFIED_KEY_INPUT_READY: status / prepare / handoff / stop\n",
  );
  try {
    for await (const line of lines) {
      check(!signal.aborted && Date.now() < deadline, "TRIAL_DEADLINE");
      if (line.trim() === "status")
        output.write(
          JSON.stringify({
            ...receiver.status(),
            trialRemainingMs: deadline - Date.now(),
          }) + "\n",
        );
      else if (line.trim() === "prepare") {
        check(
          deadline - Date.now() >= 5 * 60 * 1000,
          "KEY_CREATION_TIME_REQUIRED",
        );
        output.write(JSON.stringify(await receiver.beforeCreate()) + "\n");
      } else if (line.trim() === "handoff") {
        await receiver.handoff();
        const file = path.join(root, "stripe-keys.json"),
          keys = privateInput(file, root);
        try {
          check(
            Object.keys(keys).sort().join(",") === "app,lifecycle,listener" &&
              Object.values(keys).every((v) =>
                /^rk_test_[A-Za-z0-9]{24,500}$/.test(v),
              ) &&
              new Set(Object.values(keys)).size === 3,
            "RESTRICTED_KEYS_REQUIRED",
          );
          Object.assign(received, keys);
          fs.unlinkSync(file);
          handed = true;
          return;
        } finally {
          for (const k of Object.keys(keys)) keys[k] = undefined;
        }
      } else throw Error("KEY_STAGE_STOPPED");
    }
    throw Error("KEY_STAGE_INPUT_CLOSED");
  } finally {
    signal.removeEventListener("abort", stop);
    lines.close();
    if (!handed) await receiver.close("staged_stopped");
  }
}
