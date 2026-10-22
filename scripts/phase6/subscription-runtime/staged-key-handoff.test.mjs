import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { stagedKeyHandoff } from "./staged-key-handoff.mjs";

async function waitFor(fn) {
  for (let n = 0; n < 100; n++) {
    if (fn()) return;
    await delay(10);
  }
  assert.fail("bounded wait failed");
}
for (const mode of ["handoff", "abort", "input-closed", "insufficient-time"]) {
  test(`post-auth receiver uses the original deadline and erases on ${mode}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-staged-"));
    fs.chmodSync(root, 0o700);
    for (const name of ["base-credentials.json", "plan.json"])
      fs.writeFileSync(path.join(root, name), "{}", { mode: 0o600 });
    const input = new PassThrough(),
      output = new PassThrough();
    const abort = new AbortController(),
      received = {};
    let text = "";
    output.on("data", (b) => {
      text += b.toString();
    });
    const pending = stagedKeyHandoff({
      root,
      input,
      output,
      received,
      signal: abort.signal,
      deadline: Date.now() + (mode === "insufficient-time" ? 1000 : 600000),
    });
    // Attach the rejection handler before deliberately aborting.
    const outcome = pending.then(
      () => true,
      () => false,
    );
    try {
      if (mode === "insufficient-time") {
        assert.equal(await outcome, false);
        assert(!fs.existsSync(path.join(root, "input-ui.json")));
        return;
      }
      await waitFor(() => text.includes("AUTH_VERIFIED_KEY_INPUT_READY"));
      const { url } = JSON.parse(
        fs.readFileSync(path.join(root, "input-ui.json")),
      );
      input.write("prepare\n");
      await waitFor(() => text.includes('"ready":true'));
      if (mode === "handoff") {
        const html = await (await fetch(url)).text();
        const keys = {
          listener: "rk_test_" + "a".repeat(32),
          app: "rk_test_" + "b".repeat(32),
          lifecycle: "rk_test_" + "c".repeat(32),
        };
        const response = await fetch(url, {
          method: "POST",
          headers: { Origin: new URL(url).origin },
          body: new URLSearchParams({
            ...keys,
            csrf: html.match(/name="csrf" value="([^"]+)"/)[1],
          }),
        });
        assert.equal(response.status, 200);
        await response.body.cancel();
        input.write("handoff\n");
        assert.equal(await outcome, true);
        assert.deepEqual(received, keys);
        assert(!fs.existsSync(path.join(root, "stripe-keys.json")));
        for (const value of Object.values(keys)) assert(!text.includes(value));
      } else {
        if (mode === "abort") abort.abort();
        else input.end();
        assert.equal(await outcome, false);
        for (const file of [
          "base-credentials.json",
          "plan.json",
          "stripe-keys.json",
        ])
          assert(!fs.existsSync(path.join(root, file)));
        assert.deepEqual(received, {});
      }
    } finally {
      abort.abort();
      await outcome;
      input.destroy();
      output.destroy();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
