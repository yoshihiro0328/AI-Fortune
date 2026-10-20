export const API_VERSION = "2026-09-30.endive";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { check, TARGET } from "./policy.mjs";
import { stopChild } from "../payment-runtime/processes.mjs";
export function listener({
  binary,
  checksum,
  key,
  run,
  apiVersion,
  readAccount,
}) {
  let child,
    ready = false;
  return {
    async start() {
      check(
        !child && /^rk_test_[A-Za-z0-9]+$/.test(key),
        "RESTRICTED_LISTENER_KEY_REQUIRED",
      );
      check(
        /^[a-f0-9]{64}$/.test(checksum) &&
          createHash("sha256").update(fs.readFileSync(binary)).digest("hex") ===
            checksum,
        "CLI_HASH_MISMATCH",
      );
      check(apiVersion === API_VERSION, "API_VERSION_MISMATCH");
      check((await readAccount()).id === TARGET.account, "ACCOUNT_MISMATCH");
      child = spawn(
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
            STRIPE_DEVICE_NAME: "yorisoi-plus-" + run,
          },
          detached: true,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      return new Promise((resolve, reject) => {
        let tail = "",
          done = false;
        const fail = () => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            tail = "";
            reject(Error("LISTENER_NOT_READY"));
          }
        };
        const timer = setTimeout(fail, 30000);
        const read = (x) => {
          tail = (tail + x.toString("utf8")).slice(-8192);
          const secret = tail.match(/whsec_[A-Za-z0-9]+/)?.[0];
          if (
            secret &&
            /Ready!/i.test(tail) &&
            tail.includes(apiVersion) &&
            !done
          ) {
            done = true;
            ready = true;
            clearTimeout(timer);
            tail = "";
            resolve({ secret, apiVersion, account: TARGET.account });
          }
        };
        child.stdout.on("data", read);
        child.stderr.on("data", read);
        child.once("error", fail);
        child.once("exit", () => {
          ready = false;
          fail();
        });
      });
    },
    alive: () =>
      ready && child?.exitCode === null && child?.signalCode === null,
    async stop() {
      ready = false;
      await stopChild(child);
      key = undefined;
    },
  };
}
