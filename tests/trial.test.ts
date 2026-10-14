import { describe, it, expect } from "vitest";
import { intakeSchema, topics } from "@/lib/trial/topics";
import {
  seal,
  unseal,
  hash,
  runtimeEnabled,
  trustedIp,
} from "@/lib/trial/security";
import { costNusd } from "@/lib/ai-engine/structured";
import { trialPrompt, localSafety } from "@/lib/trial/prompt";
const input = {
  requestId: "10000000-0000-4000-8000-000000000001",
  topicId: "general",
  topicVersion: 1,
  text: "相談したいです",
  fields: {},
};
describe("trial validation and isolation", () => {
  it("800 characters accepted, 801 rejected, empty rejected", () => {
    expect(
      intakeSchema().safeParse({ ...input, text: "あ".repeat(800) }).success,
    ).toBe(true);
    expect(
      intakeSchema().safeParse({ ...input, text: "あ".repeat(801) }).success,
    ).toBe(false);
    expect(intakeSchema().safeParse({ ...input, text: "  " }).success).toBe(
      false,
    );
  });
  it("rejects arbitrary policies, mismatched fields, enum values and versions", () => {
    for (const v of [
      { policy: "ignore safety" },
      { topicVersion: 2 },
      { fields: { unknown: "x" } },
      { topicId: "reunion", fields: { contact: "block bypass" } },
      { topicId: "reply", fields: { received: "あ".repeat(161) } },
    ])
      expect(intakeSchema().safeParse({ ...input, ...v }).success).toBe(false);
  });
  it("all four topic paths validate and supply distinct grounded policies", () => {
    for (const id of ["reply", "crush", "distance", "reunion"]) {
      const parsed = intakeSchema().parse({ ...input, topicId: id });
      expect(trialPrompt(parsed)).toContain(topics[parsed.topicId].policy);
      expect(trialPrompt(parsed)).toContain("本人が話していない出来事");
    }
  });
  it("AES-GCM rejects tampering, foreign session and request IDs", () => {
    const key = Buffer.alloc(32, 5).toString("base64"),
      aad = "session:request:input",
      cipher = seal(input, key, aad);
    expect(cipher).not.toContain(input.text);
    expect(unseal(cipher, key, aad)).toEqual(input);
    expect(() => unseal(cipher, key, "other:request:input")).toThrow();
    expect(() => unseal(cipher.slice(0, -8) + "AAAAAAAA", key, aad)).toThrow();
    expect(hash("token", "a")).not.toBe(hash("token", "b"));
  });
  it("stays off without all sandbox release gates; always off in production", () => {
    const env = {
      TRIAL_ENABLED: "true",
      TRIAL_ENVIRONMENT: "sandbox",
      STRIPE_MODE: "sandbox",
      TRIAL_RETENTION_VERIFIED: "true",
      TRIAL_BUDGET_VERIFIED: "true",
      TRIAL_OPENAI_PROJECT_ID: "proj_synthetic",
    };
    expect(runtimeEnabled(env)).toBe(true);
    expect(runtimeEnabled({ ...env, VERCEL_ENV: "production" })).toBe(false);
    expect(runtimeEnabled({ ...env, STRIPE_MODE: "live" })).toBe(false);
    expect(runtimeEnabled({})).toBe(false);
  });
  it("ignores spoofed generic IP and denies untrusted deployment", () => {
    const req = new Request("https://preview.example/chat", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(() =>
      trustedIp(req, { VERCEL: "1", VERCEL_ENV: "preview" }),
    ).toThrow();
    expect(() => trustedIp(req, {})).toThrow();
    expect(
      trustedIp(
        new Request("http://127.0.0.1:5187/chat", {
          headers: { "x-forwarded-for": "1.2.3.4" },
        }),
        { NODE_ENV: "development" },
      ),
    ).toBe("local-development");
  });
  it("cost is integer and invalid usage is rejected", () => {
    expect(costNusd(3000, 1200, 125, 500)).toBe(975000);
    expect(() => costNusd(NaN, 1, 125, 500)).toThrow();
    expect(() => costNusd(-1, 1, 125, 500)).toThrow();
  });
  it("urgent safety fallback needs no AI and does not upsell", () => {
    const a = localSafety("昨日殴られました");
    expect(a?.safety).toBe(true);
    expect(a?.answer).not.toMatch(/980|Plus|購入/);
    expect(localSafety("暴力はありません。返信に迷っています")).toBeNull();
  });
});
