import { describe, it, expect } from "vitest";
import {
  authSchema,
  passwordSchema,
  authMessage,
} from "../src/lib/auth-validation";
import { contactSchema } from "../src/lib/contact-validation";
describe("auth input and account privacy", () => {
  it("matches the hosted four-character-class password requirements", () => {
    expect(passwordSchema.safeParse("TestLongPassword123!").success).toBe(true);
    for (const value of [
      "testlongpassword123!",
      "TESTLONGPASSWORD123!",
      "TestLongPassword123",
      "TestLongPassword!!",
    ])
      expect(passwordSchema.safeParse(value).success).toBe(false);
    // Login still accepts older passwords; strength rules only govern new credentials.
    expect(
      authSchema.safeParse({
        action: "login",
        email: "test@example.com",
        password: "old",
      }).success,
    ).toBe(true);
  });
  it("explains standard SMTP recipient restrictions without claiming delivery", () => {
    expect(authMessage("email_address_not_authorized")).toContain(
      "テスト参加者",
    );
  });
  it("rejects signup without explicit consent", () =>
    expect(
      authSchema.safeParse({
        action: "signup",
        email: "test@example.com",
        password: "LongPassword1234",
      }).success,
    ).toBe(false));
  it.each(["short1", "abcdefghijklmnop", "1234567890123"])(
    "rejects weak password %s",
    (p) => expect(passwordSchema.safeParse(p).success).toBe(false),
  );
  it("normalizes email without accepting an injected user id", () => {
    const r = authSchema.parse({
      action: "login",
      email: "TEST@example.com",
      password: "LongPassword1234",
      user_id: "victim",
    });
    expect(r).toEqual({
      action: "login",
      email: "test@example.com",
      password: "LongPassword1234",
    });
  });
  it("does not expose provider internals", () =>
    expect(authMessage("database_error")).not.toContain("database"));
  it("localizes unconfirmed account", () =>
    expect(authMessage("email_not_confirmed")).toContain("メール認証"));
});
describe("contact validation", () => {
  const valid = {
    name: "テスト",
    email: "test@example.com",
    message: "架空の問い合わせ動作確認です。",
    website: "",
    startedAt: 1,
    consent: true,
  };
  it("accepts a bounded message", () =>
    expect(contactSchema.safeParse(valid).success).toBe(true));
  it.each([
    { message: "x" },
    { message: "x".repeat(5001) },
    { email: "bad" },
    { name: "" },
    { consent: false },
  ])("rejects invalid input %j", (extra) =>
    expect(contactSchema.safeParse({ ...valid, ...extra }).success).toBe(false),
  );
});
