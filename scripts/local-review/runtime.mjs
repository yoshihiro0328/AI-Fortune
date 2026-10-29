import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
export const origin = "http://127.0.0.1:5318";
export const profile =
  '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';
export function environment(destination) {
  // Explicit allowlist: never inherit provider credentials, NODE_OPTIONS, proxy settings or paid features.
  return {
    PATH: path.dirname(process.execPath) + ":/usr/bin:/bin",
    HOME: destination,
    TMPDIR: destination,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_APP_URL: origin,
    LOCAL_REVIEW_ISOLATED: "true",
    TRIAL_ENABLED: "false",
    PREVIEW_DEMO_ENABLED: "false",
    STRIPE_LIVE_CHECKOUT_ENABLED: "false",
    AUTH_EMAIL_MODE: "disabled",
  };
}
export async function portFree() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(5318, "127.0.0.1", () => s.close(resolve));
  });
}
export async function runIsolated(destination, args, logName) {
  const log = fs.openSync(path.join(destination, logName), "a", 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/sandbox-exec",
        ["-p", profile, process.execPath, ...args],
        {
          cwd: destination,
          env: environment(destination),
          stdio: ["ignore", log, log],
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(Error("LOCAL_REVIEW_BUILD_FAILED")),
      );
    });
  } finally {
    fs.closeSync(log);
  }
}
export async function start(destination) {
  if (process.platform !== "darwin" || !path.isAbsolute(destination))
    throw Error("MAC_REVIEW_DIRECTORY_REQUIRED");
  const manifestPath = path.join(destination, "review-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest.credentials !== false ||
    manifest.externalConnections !== false ||
    !fs.existsSync(path.join(destination, ".next/BUILD_ID"))
  )
    throw Error("BUILT_ISOLATED_SNAPSHOT_REQUIRED");
  await portFree();
  const log = fs.openSync(path.join(destination, "server.log"), "a", 0o600);
  const child = spawn(
    "/usr/bin/sandbox-exec",
    ["-p", profile, process.execPath, "scripts/local-review/server.mjs"],
    {
      cwd: destination,
      env: environment(destination),
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  child.unref();
  fs.closeSync(log);
  manifest.pid = child.pid;
  manifest.started = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  for (let i = 0; i < 100; i++) {
    try {
      const h = await (
        await fetch(origin + "/__review/health", {
          signal: AbortSignal.timeout(1000),
        })
      ).json();
      if (h.pid === child.pid && h.runtime === "production-build") return h;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {}
  throw Error("LOCAL_REVIEW_NOT_READY");
}
export async function stop(destination) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(destination, "review-manifest.json"), "utf8"),
  );
  const h = await (
    await fetch(origin + "/__review/health", {
      signal: AbortSignal.timeout(2000),
    })
  ).json();
  if (
    h.pid !== manifest.pid ||
    h.synthetic !== true ||
    h.external !== false ||
    h.runtime !== "production-build"
  )
    throw Error("REVIEW_PROCESS_MISMATCH");
  process.kill(manifest.pid, "SIGTERM");
  for (let i = 0; i < 50; i++) {
    let alive = true;
    try {
      process.kill(manifest.pid, 0);
    } catch {
      alive = false;
    }
    if (!alive) {
      await portFree();
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("REVIEW_PROCESS_DID_NOT_EXIT");
}
