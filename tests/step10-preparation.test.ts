import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  fixturePlan,
  validatePlan,
  insertSQL,
  cleanupSQL,
  tables,
} from "../scripts/phase6/step10-fixtures.mjs";
import {
  preparation,
  externalFlags,
} from "../scripts/phase6/step10-prepare.mjs";
const plan = () =>
  fixturePlan([randomUUID(), randomUUID()], ["a".repeat(64), "b".repeat(64)]);
describe("STEP10 preparation cannot execute hosted writes", () => {
  it("has no execution mode", () =>
    expect(() => preparation(["--apply"], {})).toThrow());
  it("does not accept approval as a bypass", () =>
    expect(() => preparation(["--plan", "--approved"], {})).toThrow());
  it("only prepares twelve nonbilling rows", () =>
    expect(preparation(["--plan"], {})).toMatchObject({
      hostedExecution: false,
      networkCalls: 0,
      total: 12,
      authUsersCreated: 0,
      profilesCreated: 0,
    }));
  it("rejects even false as a dynamic diagnosis identifier", () =>
    expect(() =>
      preparation(["--plan"], { DYNAMIC_DIAGNOSTIC: "false" }),
    ).toThrow());
  for (const flag of externalFlags)
    it("rejects external flag " + flag, () =>
      expect(() => preparation(["--plan"], { [flag]: "1" })).toThrow(),
    );
  for (const key of [
    "DATABASE_URL",
    "PGHOST",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "OPENAI_API_KEY",
    "NODE_OPTIONS",
    "DOTENV_CONFIG_PATH",
  ])
    it("rejects inherited " + key, () =>
      expect(() => preparation(["--plan"], { [key]: "unexpected" })).toThrow(),
    );
});
describe("STEP10 fixture scoping", () => {
  it("requires distinct users", () => {
    const u = randomUUID();
    expect(() =>
      fixturePlan([u, u], ["a".repeat(64), "b".repeat(64)]),
    ).toThrow();
  });
  it("requires distinct anonymous hashes", () =>
    expect(() =>
      fixturePlan(
        [randomUUID(), randomUUID()],
        ["a".repeat(64), "a".repeat(64)],
      ),
    ).toThrow());
  it("rejects SQL injection in users", () =>
    expect(() =>
      fixturePlan(
        ["';drop table profiles;", randomUUID()],
        ["a".repeat(64), "b".repeat(64)],
      ),
    ).toThrow());
  it("rejects old project", () =>
    expect(() =>
      validatePlan({ ...plan(), project: "rnvrdrfdbapfafwjbygo" }),
    ).toThrow());
  it("rejects a copied UUID", () => {
    const p = plan();
    p.rows.diagnoses[0] = p.rows.consultation_subjects[0];
    expect(() => validatePlan(p)).toThrow();
  });
  it("requires exactly two rows in every table", () => {
    const p = plan();
    p.rows.diagnoses.push(p.rows.free_reports.pop()!);
    expect(() => validatePlan(p)).toThrow();
  });
  it("refuses extra tables", () => {
    const p = plan();
    p.rows.profiles = [randomUUID(), randomUUID()];
    expect(() => validatePlan(p)).toThrow();
  });
  it("never creates credentials, users, payments or AI calls", () => {
    const s = insertSQL(plan());
    expect((s.match(/insert into/g) || []).length).toBe(12);
    expect(s).not.toMatch(
      /insert into (auth\.|public\.(profiles|payments|subscriptions|ai_calls))/,
    );
    expect(s).toContain("'ready',false,'free'");
  });
  it("explicitly scopes all cleanup deletions", () => {
    const p = plan(),
      s = cleanupSQL(p);
    expect((s.match(/delete from public\./g) || []).length).toBe(6);
    for (const t of tables) for (const id of p.rows[t]) expect(s).toContain(id);
    expect(s).not.toMatch(
      /delete from (auth|public\.profiles)|truncate|disable row level/i,
    );
  });
  it("guards against cascade and set-null dependencies", () => {
    const s = cleanupSQL(plan());
    for (const t of [
      "payments",
      "diagnosis_selected_questions",
      "consultation_ai_calls",
      "trial_thread_context",
      "subject_diagnoses",
    ])
      expect(s).toContain("from public." + t);
    const lock = s.split("lock table ")[1].split(" in share row exclusive")[0];
    expect(lock).toContain("public.consultation_ai_calls");
    expect(lock).toContain("public.payments");
    expect(s).toContain("Fixture FK schema drift");
    expect(s).toContain("Fixture count mismatch");
  });
});
