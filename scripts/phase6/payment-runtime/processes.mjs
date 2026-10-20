import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { insist } from "./policy.mjs";
export function sandboxProfile(privateDir, brokerPort = 5209) {
  privateDir = fs.realpathSync(privateDir);
  insist(!/["\\\n]/.test(privateDir) && Number.isInteger(brokerPort));
  return `(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:${brokerPort}"))(deny file-read* (subpath "${privateDir}"))`;
}
export function startApp({ cwd, env, privateDir }) {
  insist(process.platform === "darwin", "OS_SANDBOX_UNAVAILABLE");
  return spawn(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      sandboxProfile(privateDir),
      process.execPath,
      "--import",
      "./scripts/phase6/payment-runtime/fetch.mjs",
      "./scripts/phase6/payment-runtime/server.mjs",
    ],
    {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
}
export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000).unref())]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
    await Promise.race([
      exited,
      new Promise((r) => setTimeout(r, 2000).unref()),
    ]);
  }
  insist(
    child.exitCode !== null || child.signalCode !== null,
    "PROCESS_STILL_RUNNING",
  );
}
export function waitReady(child, ms = 90000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("START_TIMEOUT")), ms);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("CHILD_START_FAILED"));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("CHILD_EARLY_EXIT"));
    });
    child.on("message", (m) => {
      if (m?.ready === true) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}
// Called only after the operator has verified the installed CLI's supported flags and key scope.
export function listenerArgs(run) {
  return [
    "listen",
    "--project-name",
    "yorisoi-payment-" + run,
    "--events",
    "checkout.session.completed",
    "--events-from",
    "@self",
    "--skip-update",
    "--forward-to",
    "http://127.0.0.1:5209/webhook",
  ];
}
export function startListener({ binary, run, key, onUnexpectedExit }) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./listener-worker.mjs", import.meta.url)),
      binary,
      run,
    ],
    {
      env: {
        PATH: "/usr/bin:/bin",
        STRIPE_API_KEY: key,
        STRIPE_DEVICE_NAME: "yorisoi-payment-" + run,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  // Bounded in-memory parsing only. stdout/stderr are never printed or stored.
  const ready = new Promise((resolve, reject) => {
    let tail = "",
      done = false;
    const timer = setTimeout(
      () => reject(new Error("LISTENER_NOT_READY")),
      30000,
    );
    const read = (chunk) => {
      tail = (tail + chunk.toString("utf8")).slice(-4096);
      const secret = tail.match(/whsec_[A-Za-z0-9]+/);
      if (secret && !done) {
        done = true;
        clearTimeout(timer);
        resolve(secret[0]);
        tail = "";
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("LISTENER_START_FAILED"));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      if (!done) reject(new Error("LISTENER_EARLY_EXIT"));
      else onUnexpectedExit();
    });
  });
  return { child, ready };
}
