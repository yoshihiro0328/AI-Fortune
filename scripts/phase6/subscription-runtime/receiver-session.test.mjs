import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  receiverSession,
  SECRET_WINDOW_MS,
  START_RESERVE_MS,
  verifyHandoffWindow,
} from "./receiver-session.mjs";
import { assembleHandoff } from "./private-handoff.mjs";
import { erasePrivateInputs } from "./supervisor.mjs";

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "plus-owner-wait-"));
  fs.chmodSync(directory, 0o700);
  let time = 1000,
    callback,
    scheduled = 0;
  const write = (name, value) =>
    fs.writeFileSync(path.join(directory, name), JSON.stringify(value), {
      mode: 0o600,
    });
  write("base-credentials.json", {
    anon: "synthetic",
    service: "synthetic",
    cPassword: "synthetic-c",
    dPassword: "synthetic-d",
    vaultKey: Buffer.alloc(32, 1).toString("base64"),
  });
  write("plan.json", { synthetic: true });
  const session = await receiverSession({
    directory,
    now: () => time,
    schedule(fn, ms) {
      assert.equal(ms, SECRET_WINDOW_MS);
      callback = fn;
      scheduled++;
      return 1;
    },
    cancel() {},
  });
  const html = await (await fetch(session.url)).text();
  const values = {
    csrf: html.match(/name="csrf" value="([^"]+)"/)[1],
    listener: "rk_test_" + "a".repeat(32),
    app: "rk_test_" + "b".repeat(32),
    lifecycle: "rk_test_" + "c".repeat(32),
  };
  return {
    directory,
    session,
    advance: (ms) => {
      time += ms;
    },
    now: () => time,
    scheduled: () => scheduled,
    expire: () => callback(),
    post: (v = values) =>
      fetch(session.url, {
        method: "POST",
        headers: { Origin: new URL(session.url).origin },
        body: new URLSearchParams(v),
      }),
    values,
    async dispose() {
      await session.close("test_finished");
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("owner wait → live recipient probe → synthetic submission → handoff → start consumes once", async () => {
  const f = await fixture();
  try {
    f.advance(7 * 24 * 60 * 60 * 1000);
    assert.equal(f.scheduled(), 0);
    assert.equal(
      (await f.session.beforeCreate()).remainingMs,
      SECRET_WINDOW_MS,
    );
    assert.equal((await f.post()).status, 200);
    assert.equal(f.scheduled(), 1);
    assert.equal(f.session.status().remainingMs, SECRET_WINDOW_MS);
    await f.session.handoff();
    verifyHandoffWindow(f.directory, f.now());
    assert.throws(() =>
      verifyHandoffWindow(f.directory, f.now() + SECRET_WINDOW_MS),
    );
    const output = assembleHandoff(f.directory);
    // Same private assembly used by run-approved; no provider/Stripe is invoked.
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(output))).length, 8);
    assert(!fs.existsSync(path.join(f.directory, "stripe-keys.json")));
    assert(!fs.existsSync(path.join(f.directory, "base-credentials.json")));
    assert.throws(() => assembleHandoff(f.directory));
    assert(
      erasePrivateInputs(
        [output, path.join(f.directory, "plan.json")],
        f.directory,
      ),
    );
    await assert.rejects(receiverSession({ directory: f.directory }));
  } finally {
    await f.dispose();
  }
});

test("invalid submission starts fixed deadline; correction cannot extend it; timeout erases inputs", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.post({ ...f.values, csrf: "wrong" })).status, 400);
    f.advance(SECRET_WINDOW_MS - START_RESERVE_MS + 1);
    assert.equal((await f.post()).status, 200);
    assert.equal(f.scheduled(), 1);
    await assert.rejects(f.session.handoff());
    await assert.rejects(f.session.beforeCreate());
    f.advance(START_RESERVE_MS);
    await f.expire();
    assert.equal(f.session.status().closed, true);
    for (const file of [
      "plan.json",
      "base-credentials.json",
      "stripe-keys.json",
    ])
      assert(!fs.existsSync(path.join(f.directory, file)));
  } finally {
    await f.dispose();
  }
});

for (const reason of [
  "stopped",
  "input_closed",
  "interrupted",
  "failed_no_retry",
]) {
  test(`pre/post submission ${reason} closes independently and erases without startup`, async () => {
    for (const submit of [false, true]) {
      const f = await fixture();
      try {
        if (submit) assert.equal((await f.post()).status, 200);
        const result = await f.session.close(reason);
        assert.equal(result.erased, true);
        assert.equal(result.reason, reason);
        await assert.rejects(f.session.beforeCreate());
        await assert.rejects(f.session.handoff());
        assert(!fs.existsSync(path.join(f.directory, "base-credentials.json")));
        assert(!fs.existsSync(path.join(f.directory, "stripe-keys.json")));
      } finally {
        await f.dispose();
      }
    }
  });
}
