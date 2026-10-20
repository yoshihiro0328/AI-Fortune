import fs from "node:fs";
import assert from "node:assert/strict";
import { isolatedSubscription } from "./isolated.mjs";
import { startRuntime, closeAttempt } from "./runtime.mjs";
import { control } from "./control.mjs";
import { TARGET } from "./policy.mjs";
const failUpstream = process.argv.includes("--upstream-failure");
const db = await isolatedSubscription(),
  before = await db.protectedState();
let runtime;
try {
  runtime = await startRuntime({
    m: db.m,
    transport: failUpstream
      ? async () => {
          throw Error("SYNTHETIC_UPSTREAM_FAILURE");
        }
      : db.transport,
  });
  const result = await control({
    alive: runtime.alive,
    execute: async () => {
      if (failUpstream) {
        const r = await fetch(TARGET.broker + "/proxy", {
          method: "POST",
          headers: { "x-payment-token": runtime.token },
          body: JSON.stringify({
            method: "GET",
            url: TARGET.stripe + "/v1/account",
            headers: {},
          }),
        });
        assert.equal(r.status, 403);
        assert.equal(runtime.alive(), false);
        throw Error("EXPECTED_SYNTHETIC_STOP");
      }
      assert.equal(await db.protectedState(), before);
      return true;
    },
    cleanup: async () =>
      closeAttempt({
        stopProcesses: async () => {
          await runtime.stop();
          return true;
        },
        endContracts: async () => db.subscriptions.size === 0,
        deactivatePrice: async () => {
          await db.pg.query(
            "update price_versions set active=false where id=$1",
            [db.m.version],
          );
          return true;
        },
        restorePortalBinding: async () => {
          await db.pg.exec(
            "update service_settings set portal_configuration_id=null where id",
          );
          return true;
        },
        eraseTemporary: async () => !fs.existsSync(runtime.dir),
        revokeKeys: async () => true,
      }),
  });
  assert.equal(await db.protectedState(), before);
  console.log(
    JSON.stringify({
      ...result,
      providerConnections: 0,
      realCredentials: false,
    }),
  );
  process.exitCode = result.exitCode;
} finally {
  await runtime?.stop();
  await db.close();
}
