import { describe, it, expect } from "vitest";
import {
  newSession,
  sessionHash,
  owns,
  sameOrigin,
  secureEqual,
} from "../src/lib/security";
import { freeSchema, paidSchema, followupSchema } from "../src/lib/ai/schemas";
import { paidSession } from "../src/lib/stripe/verify";
import Stripe from "stripe";
describe("anonymous ownership", () => {
  const token = newSession(),
    hash = sessionHash(token, "test-secret");
  const d = { user_id: null, anonymous_session_id: hash };
  it("permits owner cookie", () => expect(owns(d, hash, null)).toBe(true));
  it("rejects guessed id without cookie", () =>
    expect(owns(d, null, null)).toBe(false));
  it("rejects other anonymous session", () =>
    expect(owns(d, sessionHash(newSession(), "test-secret"), null)).toBe(
      false,
    ));
  it("only authenticated owner after account linking", () => {
    expect(owns({ ...d, user_id: "owner" }, hash, null)).toBe(false);
    expect(owns({ ...d, user_id: "owner" }, null, "other")).toBe(false);
    expect(owns({ ...d, user_id: "owner" }, null, "owner")).toBe(true);
  });
  it("stores no raw bearer", () => expect(hash).not.toBe(token));
});
describe("CSRF and service auth", () => {
  it("rejects missing and hostile origin", () => {
    expect(sameOrigin(null, "https://example.com")).toBe(false);
    expect(sameOrigin("https://evil.com", "https://example.com")).toBe(false);
    expect(sameOrigin("https://example.com", "https://example.com")).toBe(true);
  });
  it("secret comparison", () => {
    expect(secureEqual("abc", "abc")).toBe(true);
    expect(secureEqual("abc", "ab")).toBe(false);
  });
});
describe("AI validation and risk", () => {
  it("rejects malformed free output and out-of-range scores", () => {
    expect(freeSchema.safeParse({ summary: "x" }).success).toBe(false);
    expect(
      freeSchema.shape.scores.safeParse({
        relationship_stability: 101,
        communication: 50,
        improvement_potential: 40,
      }).success,
    ).toBe(false);
  });
  it("requires all paid sections", () =>
    expect(paidSchema.safeParse({ overall_advice: "x" }).success).toBe(false));
  it("limits additional questions to 3", () =>
    expect(
      followupSchema.safeParse({
        needs_follow_up: true,
        questions: Array.from({ length: 4 }, () => ({
          key: "extra",
          question: "?",
          type: "textarea",
          reason: "x",
        })),
      }).success,
    ).toBe(false));
});
describe("Stripe fulfillment gate", () => {
  const s = {
    livemode: false,
    mode: "payment",
    payment_status: "paid",
    amount_total: 1980,
    currency: "jpy",
    metadata: { payment_id: "test" },
  } as unknown as Stripe.Checkout.Session;
  it("accepts only correct sandbox purchase", () =>
    expect(paidSession(s)).toBe(true));
  it.each([
    { livemode: true },
    { payment_status: "unpaid" },
    { amount_total: 198 },
    { currency: "usd" },
    { mode: "subscription" },
    { metadata: null },
  ])("rejects invalid payment %j", (patch) =>
    expect(paidSession({ ...s, ...patch } as Stripe.Checkout.Session)).toBe(
      false,
    ),
  );
  it("verifies raw webhook and rejects forged signature", () => {
    const stripe = new Stripe("sk_test_fixture");
    const raw = JSON.stringify({
      id: "evt_fixture",
      object: "event",
      type: "checkout.session.completed",
      data: { object: s },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret: "whsec_fixture",
    });
    expect(
      stripe.webhooks.constructEvent(raw, signature, "whsec_fixture").id,
    ).toBe("evt_fixture");
    expect(() =>
      stripe.webhooks.constructEvent(raw + " ", signature, "whsec_fixture"),
    ).toThrow();
    expect(() =>
      stripe.webhooks.constructEvent(raw, signature, "whsec_wrong"),
    ).toThrow();
  });
});
