import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { lifecycle, listenerArgs } from "./lifecycle.mjs";
import { journal } from "./journal.mjs";
import { isolatedSubscription } from "./isolated.mjs";
import { TARGET, EVENTS } from "./policy.mjs";
test("listener is self-only, six events and one loopback; no Live/Connect/global events", () => {
  const a = listenerArgs(randomUUID());
  assert(a.includes(EVENTS.join(",")));
  assert(a.includes("@self"));
  assert(a.includes(TARGET.broker + "/webhook"));
  assert(
    !a.some((v) => ["--live", "--forward-connect-to", "--connect"].includes(v)),
  );
});
test("scoped lifecycle: identity, one advance, ready gate, unknown end cannot resend", async () => {
  const d = await isolatedSubscription(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-journal-"));
  const j = journal(path.join(dir, "attempt.jsonl"), randomUUID()),
    calls = [];
  let clock = {
      id: d.m.clock,
      livemode: false,
      status: "ready",
      frozen_time: 1000,
    },
    fail = false;
  const l = lifecycle(d.m, {
    journal: j,
    verify: async () => true,
    request: async (r) => {
      calls.push(r);
      assert.equal(new URL(r.url).origin, TARGET.stripe);
      assert.equal(r.retry, false);
      if (r.method === "DELETE") {
        fail = true;
        throw Error("synthetic timeout");
      }
      if (r.url.endsWith("/advance")) {
        clock = {
          ...clock,
          status: "advancing",
          frozen_time: r.body.frozen_time,
        };
        return { status: 200, data: clock };
      }
      if (r.url.includes("test_clocks")) return { status: 200, data: clock };
      if (r.url.endsWith("sub_scoped"))
        return {
          status: 200,
          data: {
            id: "sub_scoped",
            customer: d.m.customer,
            livemode: false,
            metadata: { user_id: d.m.c.id },
            items: { data: [{ price: { id: d.m.price } }] },
          },
        };
      const out = await d.transport(r);
      return { status: out.status, data: JSON.parse(out.text) };
    },
  });
  try {
    await l.identify();
    await l.bindSubscription("sub_scoped");
    await assert.rejects(l.advance(1000), /CLOCK_ADVANCE_DENIED/);
    await l.advance(2000);
    await assert.rejects(l.advance(3000), /CLOCK_ADVANCE_DENIED/);
    await assert.rejects(l.confirmClock(2000), /CLOCK_NOT_READY_STOP/);
    const beforeWrongTarget = calls.length;
    await assert.rejects(l.confirmClock(3000), /CLOCK_TARGET_MISMATCH/);
    assert.equal(calls.length, beforeWrongTarget);
    clock.status = "ready";
    await l.confirmClock(2000);
    await assert.rejects(l.end("sub_other"));
    await assert.rejects(l.end("sub_scoped"), /RESULT_UNKNOWN_STOP/);
    assert(fail);
    await assert.rejects(l.end("sub_scoped"));
    assert.equal(calls.filter((x) => x.method === "DELETE").length, 1);
  } finally {
    j.close();
    await d.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
