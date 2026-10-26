// Launch only after CI/review. This process never prints credentials or its URL.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { aiKeyReceiver } from "./receiver.mjs";
const base = path.resolve("..");
// One shared approval directory. Never choose a fresh path to reset spend.
const directory = path.join(base, "private-ai-evaluation-B-20261026");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const dst = fs.lstatSync(directory);
if (
  !dst.isDirectory() ||
  dst.isSymbolicLink() ||
  dst.mode & 0o077 ||
  dst.uid !== process.getuid()
)
  throw Error("PRIVATE_DIRECTORY_REQUIRED");
if (
  fs
    .readdirSync(process.cwd())
    .some((n) => n.startsWith(".env") && n !== ".env.example")
)
  throw Error("CLEAN_DIRECTORY_REQUIRED");
if (fs.existsSync(path.join(directory, "session.json")))
  throw Error("EVALUATION_SESSION_ALREADY_EXISTS");
fs.writeFileSync(
  path.join(directory, "session.json"),
  JSON.stringify({ createdAt: Date.now(), model: "gpt-6-luna", limitUSD: 12 }),
  { mode: 0o600, flag: "wx" },
);
let child,
  expiryTimer,
  poll,
  closing = false,
  received = false;
const safeState = (data) =>
  fs.writeFileSync(
    path.join(directory, "session-status.json"),
    JSON.stringify(data),
    { mode: 0o600 },
  );
async function finish(reason) {
  if (closing) return;
  closing = true;
  clearTimeout(expiryTimer);
  clearInterval(poll);
  await receiver.close();
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 4000);
  }
  for (const name of ["openai-key.json", "input-ui.json"])
    fs.rmSync(path.join(directory, name), { force: true });
  safeState({
    phase: "closed",
    reason,
    credentialDeleted: true,
    receiverClosed: true,
  });
}
const receiver = await aiKeyReceiver({
  directory,
  onSubmission() {
    if (!expiryTimer)
      expiryTimer = setTimeout(() => finish("secret_expired"), 7200000);
  },
});
fs.writeFileSync(
  path.join(directory, "input-ui.json"),
  JSON.stringify({ url: receiver.url }),
  { mode: 0o600, flag: "wx" },
);
safeState({ phase: "awaiting_owner", ownerWaitExpires: false });
// Readiness check never emits the bearer route or HTML.
if (!(await fetch(receiver.url, { redirect: "error" })).ok)
  await finish("receiver_unavailable");
poll = setInterval(async () => {
  if (closing || received || !receiver.status().received) return;
  received = true;
  await receiver.close();
  fs.rmSync(path.join(directory, "input-ui.json"), { force: true });
  safeState({ phase: "evaluating" });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: "test",
    AI_EVALUATION_MODE: "live",
    AI_EVALUATION_DIRECTORY: directory,
  };
  // No source .env loading. The bridge loads one protected key, while all app
  // modules receive a synthetic placeholder and local PGlite only.
  child = spawn(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "scripts/phase6/ai-evaluation/evaluation.config.ts",
    ],
    { cwd: process.cwd(), env, stdio: "ignore", detached: true },
  );
  child.once("exit", () => finish("evaluation_ended"));
  child.once("error", () => finish("launch_failed"));
  setTimeout(() => finish("trial_timeout"), 1220000).unref();
}, 250);
process.on("SIGTERM", () => finish("interrupted"));
process.on("SIGINT", () => finish("interrupted"));
