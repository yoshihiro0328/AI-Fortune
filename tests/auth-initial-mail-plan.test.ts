import { expect, it } from "vitest";
import {
  AUTH_TEST_PROJECT,
  checkInitialAuthMailPlan,
} from "../scripts/phase6/auth-preparation.mjs";

const attempts = () => [
  { recipient: "A", action: "signup", atMs: 0 },
  { recipient: "B", action: "signup", atMs: 60000 },
];
const plan = (rows = attempts()) => ({
  projectRef: AUTH_TEST_PROJECT,
  attempts: rows,
});

it("prepares two initial requests without granting approval or claiming delivery", () => {
  expect(checkInitialAuthMailPlan(plan())).toEqual({
    attempts: 2,
    approvalRequired: true,
    deliveryVerified: false,
    stage: "initial",
    automaticResend: false,
  });
});
it("does not let the optional resend budget expand the initial approval", () => {
  expect(() =>
    checkInitialAuthMailPlan(
      plan([
        ...attempts(),
        { recipient: "A", action: "resend", atMs: 3720000 },
        { recipient: "B", action: "resend", atMs: 3780000 },
      ]),
    ),
  ).toThrow("Initial stage");
});
it("refuses duplicate signup even after cooldown", () => {
  const rows = attempts();
  rows[1].recipient = "A";
  expect(() => checkInitialAuthMailPlan(plan(rows))).toThrow("Initial stage");
});
it("requires both recipients in the reviewed plan", () => {
  expect(() => checkInitialAuthMailPlan(plan(attempts().slice(0, 1)))).toThrow(
    "Initial stage",
  );
});
it.each(["resend", "reset"])("refuses %s in the initial stage", (action) => {
  const rows = attempts();
  rows[1].action = action;
  expect(() => checkInitialAuthMailPlan(plan(rows))).toThrow();
});
it("refuses the existing hosted project", () => {
  expect(() =>
    checkInitialAuthMailPlan({ ...plan(), projectRef: "rnvrdrfdbapfafwjbygo" }),
  ).toThrow("Wrong Auth project");
});
it("refuses another recipient without printing the supplied value", () => {
  const rows = attempts();
  rows[1].recipient = "private@example.invalid";
  expect(() => checkInitialAuthMailPlan(plan(rows))).toThrow(
    /^Unapproved recipient\/action$/,
  );
});
it("refuses a third initial signup in a later time window", () => {
  expect(() =>
    checkInitialAuthMailPlan(
      plan([
        ...attempts(),
        { recipient: "A", action: "signup", atMs: 3720000 },
      ]),
    ),
  ).toThrow("Initial stage");
});
