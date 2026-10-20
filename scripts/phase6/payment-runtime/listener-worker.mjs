// IPC lifetime guard: CLI cannot outlive an abruptly disconnected supervisor.
import { spawn } from "node:child_process";
import { listenerArgs } from "./processes.mjs";
if (!process.send || process.argv.length !== 4)
  throw Error("SUPERVISOR_REQUIRED");
const cli = spawn(process.argv[2], listenerArgs(process.argv[3]), {
  env: {
    PATH: "/usr/bin:/bin",
    STRIPE_API_KEY: process.env.STRIPE_API_KEY,
    STRIPE_DEVICE_NAME: process.env.STRIPE_DEVICE_NAME,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
cli.stdout.pipe(process.stdout);
cli.stderr.pipe(process.stderr);
function stop() {
  cli.kill("SIGTERM");
  const t = setTimeout(() => cli.kill("SIGKILL"), 2000);
  t.unref();
}
process.on("disconnect", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
cli.on("error", () => process.exit(1));
cli.on("exit", (code) => process.exit(code ?? 1));
