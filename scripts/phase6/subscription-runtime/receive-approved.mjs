import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { receiverSession } from "./receiver-session.mjs";
import { check } from "./policy.mjs";

process.umask(0o077);
const [directory] = process.argv.slice(2);
check(
  process.argv.length === 3 &&
    path.isAbsolute(directory) &&
    process.stdin.isTTY,
);
let rl;
const receiver = await receiverSession({
  directory,
  onClosed(result) {
    rl?.close();
    process.stdin.pause();
    process.exitCode = result.reason === "handoff" ? 0 : 2;
    console.log(
      JSON.stringify({
        event: "receiver_closed",
        reason: result.reason,
        erased: result.erased,
      }),
    );
  },
});
try {
  fs.writeFileSync(
    path.join(directory, "input-ui.json"),
    JSON.stringify({ url: receiver.url }),
    { mode: 0o600, flag: "wx" },
  );
  rl = readline.createInterface({ input: process.stdin, terminal: false });
  for (const event of ["end", "error"])
    process.stdin.on(event, () => receiver.close("input_closed"));
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => receiver.close("interrupted"));
  console.log("KEY_INPUT_READY");
  for await (const line of rl) {
    if (line.trim() === "status")
      console.log(JSON.stringify(receiver.status()));
    else if (line.trim() === "prepare")
      console.log(JSON.stringify(await receiver.beforeCreate()));
    else if (line.trim() === "handoff") {
      await receiver.handoff();
      break;
    } else {
      await receiver.close(
        line.trim() === "stop" ? "stopped" : "invalid_control",
      );
      break;
    }
  }
} catch {
  await receiver.close("failed_no_retry");
}
