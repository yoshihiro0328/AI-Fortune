import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { supervisor, privateInput } from "./supervisor.mjs";
import { appTransport } from "./app-transport.mjs";
import { API_VERSION } from "./listener.mjs";
import { TARGET } from "./policy.mjs";
import { fixture } from "./provider-fixture.mjs";
import { vault } from "./vault.mjs";
const secrets = {
  app: "rk_test_syntheticApp",
  listener: "rk_test_syntheticListener",
  lifecycle: "rk_test_syntheticLifecycle",
  service: "syntheticService",
  anon: "syntheticAnon",
};
test("retained active Stripe catalog stays active during preparation, then closes inactive", async () => {
  const t = await fixture("catalog-active");
  try {
    const expected = await t.ops.observe();
    await t.ops.inspect(expected);
    assert(expected.price_versions.every((p) => p.active === false));
    await t.ops.prepare({
      c: "synthetic-password-C",
      d: "synthetic-password-D",
    });
    assert.equal(t.objects.price.active, true);
    const closed = await t.ops.cleanup();
    assert.equal(closed.complete, true);
    assert.equal(t.objects.price.active, false);
    assert((await t.ops.inspectAfter()).protectedUnchanged);
  } finally {
    await t.close();
  }
});
test("active Stripe price without matching retained baseline stops before mutations", async () => {
  const t = await fixture("normal");
  try {
    t.objects.price.active = true;
    await assert.rejects(t.ops.inspect(await t.ops.observe()), /PRICE_MISMATCH/);
    assert.equal(t.calls.filter((c) => c.method !== "GET").length, 0);
  } finally {
    await t.close();
  }
});
for (const mode of [
  "normal",
  "permission",
  "unknown",
  "interrupt",
  "cleanup-fail",
  "human-price-fail",
  "wrong-account",
  "timeout",
])
  test("actual HTTP preparation and migrated-DB cleanup: " + mode, async () => {
    const t = await fixture(mode);
    try {
      const expected = await t.ops.observe();
      if (mode === "wrong-account") {
        await assert.rejects(t.ops.inspect(expected));
        assert.equal(t.calls.filter((c) => c.method !== "GET").length, 0);
        return;
      }
      await t.ops.inspect(expected);
      let pending = t.ops.prepare({
        c: "synthetic-password-C",
        d: "synthetic-password-D",
      });
      if (mode === "interrupt") setTimeout(() => t.abort.abort(), 100);
      if (["permission", "unknown", "interrupt", "timeout"].includes(mode)) {
        await assert.rejects(pending, /RESULT_UNKNOWN_STOP/);
        await assert.rejects(
          t.ops.prepare({
            c: "synthetic-password-C",
            d: "synthetic-password-D",
          }),
        );
      } else {
        await pending;
        t.objects.sub_http = {
          id: "sub_http",
          customer: "cus_http",
          livemode: false,
          status: "active",
          default_payment_method: "pm_good",
          metadata: { user_id: t.m.c.id },
          items: { data: [{ price: { id: t.m.price } }] },
        };
        for (const [id, status, subscription] of [
          ["cs_test_http_paid", "complete", "sub_http"],
          ["cs_test_http_open", "open", null],
        ]) {
          t.objects[id] = {
            id,
            status,
            subscription,
            customer: "cus_http",
            mode: "subscription",
            amount_total: 980,
            currency: "jpy",
            livemode: false,
            metadata: { user_id: t.m.c.id },
          };
          await t.ops.bindCheckout(id);
        }
      }
      if (mode === "normal") {
        await t.ops.compatibilityPortal();
        const transport = appTransport({
          wire: t.wire,
          operations: t.ops,
          signal: t.abort.signal,
        });
        t.ops.reserveRuntime("portal", 1);
        const p = await transport({
          method: "POST",
          url: TARGET.stripe + "/v1/billing_portal/sessions",
          headers: {},
          body: new URLSearchParams({
            customer: "cus_http",
            configuration: "bpc_http",
            return_url: TARGET.app + "/account",
          }).toString(),
        });
        assert.equal(p.status, 200);
        assert.throws(
          () => t.ops.reserveRuntime("portal", 2),
          /OPERATION_LIMIT/,
        );
        await t.ops.paymentMethod("sub_http", true);
        assert.equal(t.objects.sub_http.default_payment_method, "pm_failure");
        await t.ops.paymentMethod("sub_http", false);
        assert.equal(t.objects.sub_http.default_payment_method, "pm_good");
        for (let i = 1; i <= 3; i++)
          await t.ops.advanceClock(t.m.frozenTime + i * 3600);
        await assert.rejects(
          t.ops.advanceClock(t.m.frozenTime + 4 * 3600),
          /OPERATION_LIMIT/,
        );
      }
      const result = await t.ops.cleanup();
      assert.equal(result.complete, mode === "normal");
      if (mode === "normal") {
        assert.equal(t.objects.sub_http.status, "canceled");
        assert.equal(t.objects.cs_test_http_open.status, "expired");
        assert.equal(t.objects.price.active, false);
        assert.equal(t.objects.portal.active, false);
        assert((await t.ops.inspectAfter()).protectedUnchanged);
      }
      assert.equal(await t.protectedState(), t.original);
      assert(
        t.calls.filter((c) => c.p === "/v1/customers" && c.method === "POST")
          .length <= 1,
      );
      assert(!JSON.stringify(t.records).includes("private body"));
      assert(!JSON.stringify(t.records).includes("synthetic-password"));
      assert(!JSON.stringify(t.records).includes("rk_test_"));
      assert(fs.readdirSync(t.root).every((f) => f.endsWith(".enc")));
      if (mode === "human-price-fail") {
        assert.equal(result.deactivatePrice, "failed_or_unknown");
        assert.equal(t.objects.portal.active, false);
        assert.equal(
          (
            await t.pg.query("select active from price_versions where id=$1", [
              t.m.version,
            ])
          ).rows[0].active,
          false,
        );
      }
      if (mode === "cleanup-fail")
        assert.equal(result.restorePortalBinding, "failed_or_unknown");
    } finally {
      await t.close();
    }
  });
test("mock wire cannot use real-looking credentials or non-loopback endpoint", () => {
  assert.throws(() => mockWire({ origin: "https://api.stripe.com", secrets }));
  assert.throws(() =>
    mockWire({
      origin: "http://127.0.0.1:1",
      secrets: { ...secrets, app: "rk_test_other" },
    }),
  );
});
test("encrypted backup is owner-only, verified, and never overwrites an existing record", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-vault-"));
  fs.chmodSync(dir, 0o700);
  try {
    const v = vault(dir, randomBytes(32));
    assert(v.save("before.enc", { synthetic: "private fixture" }).verified);
    assert.throws(() => v.save("before.enc", {}));
    assert.equal(fs.statSync(path.join(dir, "before.enc")).mode & 0o077, 0);
    assert(
      !fs
        .readFileSync(path.join(dir, "before.enc"))
        .includes(Buffer.from("private fixture")),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const scenario of ["normal", "unknown", "interrupt", "postcheck-mismatch"])
  test(
    "same supervisor with real mock HTTP, private-input erasure and final closure: " +
      scenario,
    async () => {
      const t = await fixture(scenario === "unknown" ? "unknown" : "normal");
      const input = new PassThrough(),
        output = new PassThrough();
      input.isTTY = true;
      const tmp = path.join(t.root, "input.json");
      fs.writeFileSync(tmp, JSON.stringify({ synthetic: true }), {
        mode: 0o600,
      });
      let app = false,
        cli = false,
        revocations = 0,
        ready = false;
      try {
        assert(privateInput(tmp, t.root).synthetic);
        const s = supervisor({
          m: t.m,
          attemptId: randomUUID(),
          wire: t.wire,
          save: t.store.save,
          record: (x) => t.records.push(x),
          human: {
            price: async (active) => {
              t.objects.price.active = active;
              return true;
            },
            revokeKeys: async () => {
              revocations++;
              return true;
            },
          },
          listener: {
            start: async () => {
              cli = true;
              return {
                account: TARGET.account,
                apiVersion: t.m.apiVersion,
                secret: "whsec_synthetic",
              };
            },
            stop: async () => {
              cli = false;
            },
            alive: () => cli,
          },
          input,
          output,
          temporary: { file: tmp, root: t.root },
          timeoutMs: 10000,
          runtimeFactory: async () => {
            app = true;
            return {
              alive: () => app,
              stop: async () => {
                app = false;
              },
            };
          },
          execute: async () => true,
        });
        output.on("data", (x) => {
          if (String(x).startsWith("ready:")) {
            ready = true;
            setImmediate(() => {
              if (scenario === "interrupt") input.end();
              else {
                if (scenario === "postcheck-mismatch")
                  t.pg
                    .exec("update service_settings set plus_limit=31")
                    .then(() => input.write("finish\n"));
                else
                  input.write(
                    "status\nportal-check\nlifecycle-check\nfinish\n",
                  );
              }
            });
          }
        });
        const result = await s.run(await s.operations.observe(), {
          c: "synthetic-password-C",
          d: "synthetic-password-D",
        });
        assert.equal(result.complete, scenario === "normal");
        assert.deepEqual(
          t.records
            .filter((r) => r.event === "provider_finished")
            .map((r) => r.complete),
          [scenario === "normal"],
        );
        assert(fs.existsSync(path.join(t.root, "completion.enc")));
        assert.equal(result.exitCode, scenario === "normal" ? 0 : 2);
        assert.equal(ready, scenario !== "unknown");
        assert(!app && !cli);
        assert.equal(revocations, 1);
        assert(!fs.existsSync(tmp));
        assert.equal(t.objects.price.active, false);
        if (t.objects.portal) assert.equal(t.objects.portal.active, false);
        assert(!JSON.stringify(t.records).includes("rk_test_"));
        await assert.rejects(s.run({}, {}), /ATTEMPT_ALREADY_STARTED/);
      } finally {
        input.destroy();
        output.destroy();
        await t.close();
      }
    },
  );

test("proposed five-advance timeline uses four scoped invoices; explicit approval is required", async () => {
  const t = await fixture("normal", {
    limit: 5,
    explicit: true,
    reference: "SYNTHETIC_TEST_APPROVAL_ONLY",
  });
  try {
    await t.ops.inspect(await t.ops.observe());
    await t.ops.prepare({
      c: "synthetic-password-C",
      d: "synthetic-password-D",
    });
    const add = async (n) => {
      const sid = "sub_http" + n,
        id = "cs_test_http" + n;
      t.objects[sid] = {
        id: sid,
        customer: "cus_http",
        livemode: false,
        status: "active",
        default_payment_method: "pm_good",
        metadata: { user_id: t.m.c.id },
        items: { data: [{ price: { id: t.m.price } }] },
      };
      t.objects[id] = {
        id,
        subscription: sid,
        status: "complete",
        payment_status: "paid",
        customer: "cus_http",
        mode: "subscription",
        amount_total: 980,
        currency: "jpy",
        livemode: false,
        metadata: { user_id: t.m.c.id },
      };
      await t.ops.bindCheckout(id);
      return sid;
    };
    const invoice = (n, sid, status) => ({
      id: "in_http" + n,
      customer: "cus_http",
      livemode: false,
      currency: "jpy",
      total: 980,
      attempt_count: 1,
      status,
      parent: { subscription_details: { subscription: sid } },
    });
    const one = await add(1);
    t.objects.invoices = [invoice(1, one, "paid")];
    await t.ops.inspectSubscription(one);
    const times = [
      30 * 86400,
      30 * 86400 + 3600,
      60 * 86400,
      60 * 86400 + 3600,
      90 * 86400,
    ];
    await t.ops.advanceClock(t.m.frozenTime + times[0]);
    t.objects.invoices.push(invoice(2, one, "draft"));
    await t.ops.inspectSubscription(one);
    await t.ops.advanceClock(t.m.frozenTime + times[1]);
    t.objects.invoices[1].status = "paid";
    await t.ops.paymentMethod(one, true);
    await t.ops.advanceClock(t.m.frozenTime + times[2]);
    t.objects.invoices.push(invoice(3, one, "draft"));
    await t.ops.advanceClock(t.m.frozenTime + times[3]);
    t.objects.invoices[2].status = "open";
    await t.ops.inspectSubscription(one);
    await t.ops.paymentMethod(one, false);
    await t.ops.endSubscription(one);
    const two = await add(2);
    t.objects.invoices.push(invoice(4, two, "paid"));
    await t.ops.inspectSubscription(two);
    await t.ops.advanceClock(t.m.frozenTime + times[4]);
    t.objects[two].status = "canceled";
    await assert.rejects(
      t.ops.advanceClock(t.m.frozenTime + times[4] + 1),
      /OPERATION_LIMIT/,
    );
    assert.equal(
      t.calls.filter((c) => c.p.endsWith("/advance") && c.method === "POST")
        .length,
      5,
    );
    const advances = t.calls.filter(
      (c) => c.p.endsWith("/advance") && c.method === "POST",
    );
    assert(advances.every((c) => typeof c.idempotency === "string"));
    assert.equal(new Set(advances.map((c) => c.idempotency)).size, 5);
    assert((await t.ops.cleanup()).complete);
    assert((await t.ops.inspectAfter()).protectedUnchanged);
  } finally {
    await t.close();
  }
});

test("provider entry rejects the wrong CLI before any request and erases private input", async () => {
  const { createProviderRun } = await import("./provider-entry.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plus-entry-"));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, "input.json"),
    binary = path.join(root, "synthetic-cli");
  fs.writeFileSync(binary, "not a real executable");
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...secrets,
      cPassword: "synthetic-password-C",
      dPassword: "synthetic-password-D",
      vaultKey: randomBytes(32).toString("base64"),
    }),
    { mode: 0o600 },
  );
  const input = new PassThrough();
  input.isTTY = true;
  try {
    assert.throws(
      () =>
        createProviderRun({
          file,
          root,
          evidenceDirectory: root,
          m: { apiVersion: API_VERSION },
          cli: { binary, checksum: "0".repeat(64) },
          input,
        }),
      /CLI_HASH_MISMATCH/,
    );
    assert(!fs.existsSync(file));
  } finally {
    input.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
