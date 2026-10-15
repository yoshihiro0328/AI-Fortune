import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  assertLocalAuthFixture,
  checkAuthMailPlan,
  AUTH_TEST_PROJECT,
} from "../scripts/phase6/auth-preparation.mjs";
const local = {
  AUTH_FIXTURE_LOCAL_ONLY: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  TEST_BASE_URL: "http://localhost:3000",
};
const plan = () => ({
  projectRef: AUTH_TEST_PROJECT,
  attempts: [
    { recipient: "A", action: "signup", atMs: 0 },
    { recipient: "B", action: "signup", atMs: 60000 },
    { recipient: "A", action: "resend", atMs: 3720000 },
    { recipient: "B", action: "resend", atMs: 3780000 },
  ],
});
it("allows explicit isolated local fixture targets", () =>
  expect(() => assertLocalAuthFixture(local)).not.toThrow());
it.each([
  { AUTH_FIXTURE_LOCAL_ONLY: undefined },
  { NEXT_PUBLIC_SUPABASE_URL: "https://rnvrdrfdbapfafwjbygo.supabase.co" },
  { NEXT_PUBLIC_SUPABASE_URL: `https://${AUTH_TEST_PROJECT}.supabase.co` },
  { TEST_BASE_URL: "https://partner-mind-vdiordna-2059.vercel.app" },
  { TEST_BASE_URL: "http://localhost.evil.invalid:3000" },
  { TEST_BASE_URL: "http://secret@localhost:3000" },
  { TEST_BASE_URL: "http://localhost:3000/path" },
  { VERCEL_ENV: "preview" },
  { NODE_ENV: "production" },
])("blocks unsafe legacy fixture configuration %j", (patch) =>
  expect(() => assertLocalAuthFixture({ ...local, ...patch })).toThrow(
    "blocked",
  ),
);
it("legacy entry point stops before reading old env or making requests", () => {
  const result = spawnSync(process.execPath, ["scripts/auth-live.mjs"], {
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Auth fixture blocked");
  expect(result.stdout).toBe("");
});
it("valid schedule does not grant approval or claim delivery", () =>
  expect(checkAuthMailPlan(plan())).toEqual({
    attempts: 4,
    approvalRequired: true,
    deliveryVerified: false,
  }));
it("refuses the existing project", () =>
  expect(() =>
    checkAuthMailPlan({ ...plan(), projectRef: "rnvrdrfdbapfafwjbygo" }),
  ).toThrow("Wrong"));
it("refuses a fifth attempt including uncertain delivery", () => {
  const p = plan();
  p.attempts.push({ recipient: "A", action: "resend", atMs: 7500000 });
  expect(() => checkAuthMailPlan(p)).toThrow("budget");
});
it("refuses a third send at the exact one-hour boundary", () => {
  const p = plan();
  p.attempts[2].atMs = 3600000;
  expect(() => checkAuthMailPlan(p)).toThrow("rate limit");
});
it("refuses resending within 60 seconds", () => {
  const p = plan();
  p.attempts = [
    p.attempts[0],
    { recipient: "A", action: "resend", atMs: 59999 },
  ];
  expect(() => checkAuthMailPlan(p)).toThrow("cooldown");
});
it("does not expose an unexpected real recipient in errors", () => {
  const p = plan();
  p.attempts[0].recipient = "private@example.invalid";
  expect(() => checkAuthMailPlan(p)).toThrow(/^Unapproved recipient\/action$/);
});
it("rejects password reset outside the initial mail scope", () => {
  const p = plan();
  p.attempts[0].action = "recovery";
  expect(() => checkAuthMailPlan(p)).toThrow("Unapproved");
});
it("rejects unordered attempts", () => {
  const p = plan();
  p.attempts.reverse();
  expect(() => checkAuthMailPlan(p)).toThrow("Invalid schedule");
});
it("rejects invalid timestamps", () => {
  const p = plan();
  p.attempts[0].atMs = NaN;
  expect(() => checkAuthMailPlan(p)).toThrow("Invalid schedule");
});
