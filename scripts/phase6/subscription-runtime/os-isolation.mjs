// macOS-only verification. Targets a disposable loopback trap, never a real service.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { sandboxProfile } from "../payment-runtime/processes.mjs";
assert.equal(process.platform, "darwin");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plus-os-"));
fs.writeFileSync(path.join(dir, "synthetic-secret"), "synthetic-only", {
  mode: 0o600,
});
let hits = 0;
const trap = http.createServer((_q, r) => {
  hits++;
  r.end("unexpected");
});
try {
  await new Promise((r) => trap.listen(0, "127.0.0.1", r));
  const port = trap.address().port;
  const script = `import net from 'node:net';import http from 'node:http';import fs from 'node:fs';import {spawnSync} from 'node:child_process';
 await new Promise((yes,no)=>{const s=net.connect(${port},'127.0.0.1');s.on('connect',()=>no(Error('BYPASS')));s.on('error',yes);s.setTimeout(1000,()=>no(Error('NO_DENIAL')));});
 await new Promise((yes,no)=>http.get('http://127.0.0.1:${port}',()=>no(Error('HTTP_BYPASS'))).on('error',yes));
 let denied=false;try{fs.readFileSync(${JSON.stringify(path.join(dir, "synthetic-secret"))});}catch{denied=true;}if(!denied)throw Error('FILE_BYPASS');
 const r=spawnSync(process.execPath,['--input-type=module','-e',"import net from 'node:net';const s=net.connect(${port},'127.0.0.1');s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));"],{timeout:2000});if(r.status!==0)throw Error('CHILD_BYPASS');`;
  const p = spawn(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      sandboxProfile(dir, 5219),
      process.execPath,
      "--input-type=module",
      "-e",
      script,
    ],
    { env: { PATH: "/usr/bin:/bin" }, stdio: "ignore" },
  );
  const code = await new Promise((r, j) => {
    p.on("error", j);
    p.on("exit", r);
  });
  assert.equal(code, 0);
  assert.equal(hits, 0);
  console.log(
    JSON.stringify({
      passed: true,
      checks: 4,
      rawTCP: "denied",
      http: "denied",
      childProcess: "denied",
      privateRead: "denied",
      trapHits: hits,
      providerConnections: 0,
    }),
  );
} finally {
  trap.closeAllConnections();
  await new Promise((r) => trap.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
}
