import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { setImmediate as tick } from "node:timers/promises";
import { control } from "./control.mjs";
function setup(action = async () => {}) {
  const input = new PassThrough();
  input.isTTY = true;
  const stops = [],
    records = [],
    writes = [];
  const c = control({
    input,
    action,
    stop: (x) => stops.push(x),
    record: (e, d) => records.push({ e, d }),
    write: (x) => writes.push(x),
    status: () => ({ ready: true, stopping: stops.length > 0 }),
  });
  return { input, stops, records, writes, c };
}
test("TTY mandatory", () =>
  assert.throws(() => control({ input: new PassThrough() })));
test("idle is not EOF; fragmented status, verify and finish", async () => {
  const calls = [],
    s = setup(async (x) => calls.push(x));
  await tick();
  assert.equal(s.stops.length, 0);
  s.input.write("sta");
  s.input.write("tus\nverify\n");
  await tick();
  assert.deepEqual(calls, ["verify"]);
  assert.equal(s.writes.length, 1);
  s.input.write("finish\n");
  assert.deepEqual(s.stops, ["operator_finished"]);
  s.c.close();
});
for (const name of ["end", "close", "error"])
  test("input " + name + " stops", async () => {
    const s = setup();
    if (name === "end") s.input.end();
    else s.input.emit(name, ...(name === "error" ? [Error("SENSITIVE")] : []));
    await tick();
    assert(s.stops.includes(name === "error" ? "input_error" : "input_closed"));
    assert(!JSON.stringify(s.records).includes("SENSITIVE"));
    s.c.close();
  });
test("concurrent action rejected; no second body", async () => {
  let release,
    count = 0;
  const s = setup(() => {
    count++;
    return new Promise((r) => (release = r));
  });
  s.input.write("body\n");
  await tick();
  s.input.write("body\n");
  assert.deepEqual(s.stops, ["invalid_or_busy_command"]);
  release();
  await tick();
  assert.equal(count, 1);
  s.c.close();
});
test("action failure stops without printing secret", async () => {
  const s = setup(async () => {
    throw Error("SENSITIVE");
  });
  s.input.write("body\n");
  await tick();
  assert.deepEqual(s.stops, ["check_failed_or_unknown"]);
  assert(!JSON.stringify(s.records).includes("SENSITIVE"));
  s.c.close();
});
test("purchase commands refused; input never journaled", () => {
  const s = setup();
  s.input.write("duplicate\n");
  assert.deepEqual(s.stops, ["invalid_or_busy_command"]);
  assert.equal(s.records.length, 0);
  s.c.close();
});
