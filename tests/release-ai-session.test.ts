import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { readFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
const pause = () => new Promise((r) => setTimeout(r, 100));
for (const interrupted of [false, true])
  it(`synthetic session ${interrupted ? "interrupt" : "normal"} closes receiver, process and credentials`, async () => {
    const child = spawn(
      process.execPath,
      ["scripts/phase6/ai-evaluation/session.mjs", "--synthetic-session-check"],
      {
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let directory = "";
    const ended = new Promise<void>((r) => child.once("exit", () => r()));
    try {
      directory = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("SYNTHETIC_START_TIMEOUT")),
          10000,
        );
        child.stdout.once("data", (data) => {
          clearTimeout(timer);
          resolve(JSON.parse(String(data)).directory);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("SYNTHETIC_START_FAILED"));
        });
      });
      let url = "";
      for (let i = 0; i < 100; i++) {
        try {
          url = JSON.parse(
            await readFile(join(directory, "input-ui.json"), "utf8"),
          ).url;
          break;
        } catch {
          await pause();
        }
      }
      expect(url.length > 0).toBe(true);
      if (interrupted) {
        child.kill("SIGTERM");
      } else {
        const html = await (await fetch(url)).text();
        const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
        const r = await fetch(url, {
          method: "POST",
          headers: {
            origin: new URL(url).origin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            csrf,
            key: "sk-" + "synthetic".repeat(6),
          }),
        });
        expect(r.status).toBe(200);
      }
      await Promise.race([
        ended,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("SYNTHETIC_END_TIMEOUT")),
            25000,
          ).unref(),
        ),
      ]);
      const state = JSON.parse(
        await readFile(join(directory, "session-status.json"), "utf8"),
      );
      expect(state.phase).toBe("closed");
      expect(state.credentialDeleted).toBe(true);
      for (const name of ["openai-key.json", "input-ui.json"])
        await expect(access(join(directory, name))).rejects.toMatchObject({
          code: "ENOENT",
        });
      if (!interrupted) {
        const result = JSON.parse(
          await readFile(join(directory, "result.json"), "utf8"),
        );
        expect(result.terminal).toBe("completed");
        expect(result.live).toBe(false);
        expect(result.cases).toHaveLength(24);
      }
      let closed = false;
      try {
        await fetch(url);
      } catch {
        closed = true;
      }
      expect(closed).toBe(true);
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }, 40000);
