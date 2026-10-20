import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { bindControl } from "./control.mjs";

function setup({ tty = true, ready = true, action } = {}) {
  const input = new PassThrough();
  input.isTTY = tty;
  const records = [],
    stops = [],
    actions = [],
    output = [];
  let stopping = false;
  const options = {
    input,
    stop: (reason) => {
      stops.push(reason);
      stopping = true;
    },
    record: (event, data) => records.push({ event, ...data }),
    status: () => ({ ready, stopping }),
    action:
      action ??
      (async (command) => {
        actions.push(command);
      }),
    write: (text) => output.push(text),
  };
  return { input, records, stops, actions, output, options };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("plain pipe is rejected; no input is kept alive artificially", () => {
  const h = setup({ tty: false });
  assert.throws(() => bindControl(h.options), /INTERACTIVE_INPUT_REQUIRED/);
  assert.equal(h.input.listenerCount("data"), 0);
});
test("already closed terminal fails before attaching", () => {
  const h = setup();
  h.input.destroy();
  assert.throws(() => bindControl(h.options), /CONTROL_INPUT_CLOSED/);
});
test("split commands and CRLF are assembled; status performs no action", () => {
  const h = setup(),
    c = bindControl(h.options);
  h.input.write("sta");
  h.input.write("tus\r\nstatus\nfinish\n");
  assert.equal(h.output.length, 2);
  assert.deepEqual(h.actions, []);
  assert.deepEqual(h.stops, ["operator_finished"]);
  c.close();
  h.input.destroy();
});
test("status works during startup without opening purchase commands", () => {
  const h = setup({ ready: false }),
    c = bindControl(h.options);
  h.input.write("status\nrls\n");
  assert.equal(JSON.parse(h.output[0]).ready, false);
  assert.deepEqual(h.stops, ["control_not_ready"]);
  assert.deepEqual(h.actions, []);
  c.close();
  h.input.destroy();
});
for (const signal of ["end", "close", "error"])
  test(`unexpected input ${signal} stops`, async () => {
    const h = setup(),
      c = bindControl(h.options);
    if (signal === "end") h.input.end();
    else if (signal === "error")
      h.input.emit("error", Error("SECRET_NOT_LOGGED"));
    else h.input.emit("close");
    await tick();
    assert(
      h.stops.includes(signal === "error" ? "input_error" : "input_closed"),
    );
    assert(!JSON.stringify(h.records).includes("SECRET_NOT_LOGGED"));
    c.close();
    h.input.destroy();
  });
for (const text of ["PRIVATE_VALUE\n", "x".repeat(129)])
  test("invalid or oversized input fails without logging the input", () => {
    const h = setup(),
      c = bindControl(h.options);
    h.input.write(text);
    assert.deepEqual(h.stops, ["invalid_control_input"]);
    assert(!JSON.stringify(h.records).includes(text.trim()));
    c.close();
    h.input.destroy();
  });
test("existing duplicate and RLS commands remain usable in sequence", async () => {
  const h = setup(),
    c = bindControl(h.options);
  h.input.write("duplicate\n");
  await tick();
  h.input.write("rls\n");
  await tick();
  assert.deepEqual(h.actions, ["duplicate", "rls"]);
  assert.equal(
    h.records.filter((x) => x.event === "operator_check_success").length,
    2,
  );
  assert.deepEqual(h.stops, []);
  c.close();
  h.input.destroy();
});
test("parallel check commands stop instead of starting a second operation", async () => {
  let release;
  const h = setup({
    action: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  const c = bindControl(h.options);
  h.input.write("duplicate\n");
  await tick();
  h.input.write("rls\n");
  assert.deepEqual(h.stops, ["control_not_ready"]);
  c.close();
  release();
  await tick();
  assert(!h.records.some((x) => x.event === "operator_check_success"));
  h.input.destroy();
});
test("failed check stops and never records error contents", async () => {
  const h = setup({
    action: async () => {
      throw Error("PRIVATE_ERROR");
    },
  });
  const c = bindControl(h.options);
  h.input.write("rls\n");
  await tick();
  assert.deepEqual(h.stops, ["operator_check_failed"]);
  assert(!JSON.stringify(h.records).includes("PRIVATE_ERROR"));
  c.close();
  h.input.destroy();
});
test("finish cuts off any following operation in the same chunk", async () => {
  const h = setup(),
    c = bindControl(h.options);
  h.input.write("finish\nrls\n");
  await tick();
  assert.deepEqual(h.actions, []);
  c.close();
  h.input.destroy();
});
test("disposal removes listeners and late results cannot write to a closed journal", async () => {
  let release;
  const h = setup({
    action: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  const c = bindControl(h.options);
  h.input.write("rls\n");
  await tick();
  c.close();
  const n = h.records.length;
  release();
  await tick();
  assert.equal(h.records.length, n);
  for (const event of ["data", "end", "close", "error"])
    assert.equal(h.input.listenerCount(event), 0);
  h.input.destroy();
});
