import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { control } from "./control.mjs";
for (const command of ["advance", "next"])
  test(
    "atomic advance checks health; legacy next cannot skip status: " + command,
    async () => {
      const input = new PassThrough(),
        output = new PassThrough();
      input.isTTY = true;
      const order = [];
      const run = control({
        input,
        output,
        commands: ["next"],
        alive: () => {
          order.push("health");
          return true;
        },
        execute: async () => {
          order.push("execute");
          return true;
        },
        cleanup: async () => ({ complete: true }),
        timeoutMs: 1000,
      });
      input.write(command + "\nfinish\n");
      const result = await run;
      assert.equal(result.complete, command === "advance");
      assert.equal(
        order.filter((x) => x === "execute").length,
        command === "advance" ? 2 : 0,
      );
      if (command === "advance")
        assert.equal(order[order.indexOf("execute") - 1], "health");
      input.destroy();
      output.destroy();
    },
  );
for (const mode of [
  "normal",
  "eof",
  "timeout",
  "check-failed",
  "cleanup-failed",
  "process-exit",
])
  test("control wait/status/check/closure " + mode, async () => {
    const input = new PassThrough(),
      output = new PassThrough();
    input.isTTY = true;
    let n = 0,
      clean = 0,
      log = "";
    output.on("data", (x) => (log += x));
    let live = true;
    const promise = control({
      input,
      output,
      alive: () => live,
      execute: async () => {
        n++;
        if (mode === "check-failed") throw Error("synthetic");
        return true;
      },
      cleanup: async () => {
        clean++;
        return { complete: mode !== "cleanup-failed" };
      },
      timeoutMs: mode === "timeout" ? 40 : 1000,
    });
    await new Promise((r) => setTimeout(r, 15));
    assert.match(log, /ready/);
    input.write("status\n");
    await new Promise((r) => setTimeout(r, 10));
    assert.match(log, /alive/);
    if (mode === "process-exit") live = false;
    if (mode === "eof") input.end();
    else if (mode !== "timeout")
      input.write("portal-check\nlifecycle-check\nfinish\n");
    const result = await promise;
    assert.equal(clean, 1);
    assert.equal(result.exitCode, mode === "normal" ? 0 : 2);
    if (mode === "normal") assert.equal(n, 3);
    input.destroy();
    output.destroy();
  });
test("non-TTY cannot launch interactive operation", async () => {
  await assert.rejects(
    control({ input: new PassThrough() }),
    /INTERACTIVE_TTY_REQUIRED/,
  );
});
for (const cause of ["timeout", "eof"])
  test("in-flight check cannot turn " + cause + " into success", async () => {
    const input = new PassThrough(),
      output = new PassThrough();
    input.isTTY = true;
    const p = control({
      input,
      output,
      alive: () => true,
      execute: () => new Promise(() => {}),
      cleanup: async () => ({ complete: true }),
      timeoutMs: cause === "timeout" ? 20 : 1000,
    });
    input.write("status\nfinish\n");
    if (cause === "eof") setTimeout(() => input.end(), 10);
    const r = await p;
    assert.equal(r.exitCode, 2);
    assert.equal(r.reason, cause === "timeout" ? "timeout" : "input_closed");
    input.destroy();
    output.destroy();
  });
