import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  claimMonthlyContinuation,
  monthlyCarry,
  resumedMonthlyPlan,
} from "./monthly-resume.mjs";
import { operationLedger } from "./remaining-plan.mjs";
test("continuation cannot be acquired twice, including after an unknown execution", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monthly-claim-"));
  try {
    const file = path.join(dir, "claim.json"),
      run = "10000000-0000-4000-8000-000000000001";
    claimMonthlyContinuation(file, run);
    assert.throws(() =>
      claimMonthlyContinuation(file, "20000000-0000-4000-8000-000000000001"),
    );
    assert.equal(JSON.parse(fs.readFileSync(file)).run, run);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("E plus G/F at the full clock/payment allowance leaves no extra purchase or advance", () => {
  const ledger = operationLedger(resumedMonthlyPlan, monthlyCarry);
  for (let n = 0; n < 3; n++) ledger.reserve("successfulPayments", `paid-${n}`);
  for (let n = 0; n < 15; n++) ledger.reserve("clockAdvances", `clock-${n}`);
  assert.throws(() => ledger.reserve("successfulPayments", "extra-payment"));
  assert.throws(() => ledger.reserve("clockAdvances", "extra-clock"));
  assert.equal(ledger.summary().used.clockAdvances, 16);
  assert.equal(ledger.summary().used.successfulPayments, 4);
  ledger.unknown();
  assert.throws(() => ledger.reserve("customers", "unknown-write-retry"));
});
