import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { executeBody, DB } from "./sql-executor.mjs";
import { hash } from "../payment-runtime/policy.mjs";
for (const scenario of [
  "success",
  "no-tls",
  "wrong-role",
  "sql-failure",
  "missing-commit",
])
  test("psql protocol: " + scenario, async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "continuation-psql-protocol-"),
    );
    const bin = path.join(dir, "synthetic-psql"),
      ca = path.join(dir, "synthetic-ca"),
      seen = path.join(dir, "seen");
    const source = `#!${process.execPath}\nimport fs from 'node:fs';import readline from 'node:readline';
fs.writeFileSync(${JSON.stringify(path.join(dir, "args"))},JSON.stringify({args:process.argv.slice(2),env:process.env}));
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{fs.appendFileSync(${JSON.stringify(seen)},line+'\\n');
if(line==='\\\\echo CONTINUATION_TLS_GATE'){console.log(${JSON.stringify(scenario === "no-tls" ? "no SSL" : "SSL connection (protocol: TLSv1.3, cipher: TEST)")});console.log(JSON.stringify({db:'postgres',role:${JSON.stringify(scenario === "wrong-role" ? "other" : "postgres")},ro:'on'}));console.log('CONTINUATION_TLS_GATE');}
if(line==='UPDATE_ONLY_TEST_SENTINEL'){${scenario === "sql-failure" ? "process.stderr.write('ERROR: P0001');process.exit(3);" : ""}}
if(line==='\\\\echo CONTINUATION_BODY_END'){${scenario === "missing-commit" ? "" : "console.log('COMMIT');"}console.log('CONTINUATION_BODY_END');}
if(line==='\\\\q')process.exit(0);});`;
    fs.writeFileSync(bin, source, { mode: 0o700 });
    fs.writeFileSync(ca, "SYNTHETIC_NOT_A_CERTIFICATE");
    const config = {
      binary: bin,
      binarySha256: hash(source),
      ca,
      caSha256: hash(fs.readFileSync(ca)),
      password: "Synthetic:Only\\123",
    };
    const records = [];
    try {
      const work = executeBody(
        "UPDATE_ONLY_TEST_SENTINEL\n",
        config,
        dir,
        (event, d) => records.push({ event, ...d }),
      );
      if (scenario === "success")
        assert.deepEqual(await work, { exitCode: 0, commitResponse: true });
      else await assert.rejects(work);
      assert(!fs.existsSync(path.join(dir, "continuation.pgpass")));
      const sent = fs.readFileSync(seen, "utf8");
      assert.equal(
        sent.includes("UPDATE_ONLY_TEST_SENTINEL"),
        !["no-tls", "wrong-role"].includes(scenario),
      );
      const args = JSON.parse(fs.readFileSync(path.join(dir, "args")));
      assert(args.args.includes("-X") && args.args.includes("ON_ERROR_STOP=1"));
      assert(args.args.includes(DB.host));
      assert.equal(args.env.PGSSLMODE, "verify-full");
      assert.equal(args.env.PGCONNECT_TIMEOUT, "15");
      assert(!JSON.stringify(args).includes(config.password));
      assert.equal(
        records.filter((x) => x.event === "body_send_reserved").length,
        ["no-tls", "wrong-role"].includes(scenario) ? 0 : 1,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
