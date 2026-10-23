import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { keyReceiver } from "./key-receiver.mjs";

test("local human receiver rejects wrong origin, standard/duplicate keys and never echoes secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-receiver-"));
  fs.chmodSync(dir, 0o700);
  const r = await keyReceiver({ directory: dir });
  try {
    const page = await fetch(r.url);
    const html = await page.text();
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("referrer-policy"), "same-origin");
    const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    const values = {
      csrf,
      listener: "rk_test_" + "a".repeat(32),
      app: "rk_test_" + "b".repeat(32),
      lifecycle: "rk_test_" + "c".repeat(32),
    };
    const post = (v, origin = new URL(r.url).origin) =>
      fetch(r.url, {
        method: "POST",
        headers: { Origin: origin },
        body: new URLSearchParams(v),
      });
    assert.equal((await post(values, "http://example.invalid")).status, 403);
    assert.equal((await post(values, "null")).status, 403);
    assert.equal(
      (
        await fetch(r.url, {
          method: "POST",
          body: new URLSearchParams(values),
        })
      ).status,
      403,
    );
    assert(!fs.existsSync(path.join(dir, "stripe-keys.json")));
    assert.deepEqual(r.status(), { received: false, failed: false });
    assert.equal((await post({ ...values, csrf: "wrong" })).status, 400);
    assert.equal(
      (await post({ ...values, app: "sk_test_" + "d".repeat(32) })).status,
      400,
    );
    assert.equal((await post({ ...values, app: values.listener })).status, 400);
    assert(!fs.existsSync(path.join(dir, "stripe-keys.json")));
    const result = await post(values),
      body = await result.text();
    assert.equal(result.status, 200);
    assert(body.includes("安全に受け取りました"));
    for (const v of Object.values(values)) assert(!body.includes(v));
    assert.deepEqual(r.status(), { received: true, failed: false });
    const file = path.join(dir, "stripe-keys.json");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
      listener: values.listener,
      app: values.app,
      lifecycle: values.lifecycle,
    });
    const saved = fs.readFileSync(file);
    assert.equal((await post(values)).status, 409);
    assert(fs.readFileSync(file).equals(saved));
    const after = await (await fetch(r.url)).text();
    assert(!after.includes("<input"));
    assert.equal((await fetch(new URL("/wrong", r.url))).status, 404);
  } finally {
    await r.close();
    fs.rmSync(dir, { recursive: true });
  }
});

test("receiver refuses insecure directory and existing input without overwriting", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-receiver-"));
  try {
    fs.chmodSync(dir, 0o755);
    await assert.rejects(keyReceiver({ directory: dir }));
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, "stripe-keys.json"), "existing", {
      mode: 0o600,
    });
    await assert.rejects(keyReceiver({ directory: dir }));
    assert.equal(
      fs.readFileSync(path.join(dir, "stripe-keys.json"), "utf8"),
      "existing",
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test("post-close receiver accepts one restricted key only and does not echo it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postclose-receiver-"));
  fs.chmodSync(dir, 0o700);
  const r = await keyReceiver({ directory: dir, purpose: "post-close" });
  try {
    const html = await (await fetch(r.url)).text();
    assert.equal((html.match(/type="password"/g) || []).length, 1);
    const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    const app = "rk_test_" + "z".repeat(32);
    const post = (v) =>
      fetch(r.url, {
        method: "POST",
        headers: { origin: new URL(r.url).origin },
        body: new URLSearchParams({ csrf, ...v }),
      });
    assert.equal((await post({ app, listener: app })).status, 400);
    assert.equal(
      (await post({ app: "sk_test_" + "z".repeat(32) })).status,
      400,
    );
    const response = await post({ app });
    assert.equal(response.status, 200);
    assert(!(await response.text()).includes(app));
    assert.deepEqual(
      Object.keys(
        JSON.parse(fs.readFileSync(path.join(dir, "stripe-keys.json"))),
      ),
      ["app"],
    );
  } finally {
    await r.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
