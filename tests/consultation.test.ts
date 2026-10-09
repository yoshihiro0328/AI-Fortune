import { describe, it, expect } from "vitest";
import { groundedFacts, mergeMemory } from "@/lib/consultation/model";
import { estimateCost } from "@/lib/ai/cost";
import { paidSession } from "@/lib/stripe/verify";
import { ratio } from "@/lib/analytics";
import type Stripe from "stripe";
describe("continuing consultation boundaries", () => {
  it("retains exact user evidence and assistant proposals, rejects invented memory", () => {
    const facts = groundedFacts(
      [
        { kind: "event", quote: "昨日LINEが来た" },
        { kind: "goal", quote: "相手は復縁したい" },
        { kind: "suggestion", quote: "短く返してみてください" },
      ],
      "昨日LINEが来た。",
      "短く返してみてください。",
      "turn",
      "2026-10-09",
    );
    expect(facts.map((f) => f.quote)).toEqual([
      "昨日LINEが来た",
      "短く返してみてください",
    ]);
    expect(facts.every((f) => f.source === "turn")).toBe(true);
  });
  it("bounds memory, replaces regenerated facts, deduplicates quotes", () => {
    const previous = Array.from({ length: 30 }, (_, i) => ({
      kind: "event" as const,
      quote: String(i),
      source: "old",
      at: "2026-10-08",
    }));
    const fresh = {
      kind: "event" as const,
      quote: "新しい話",
      source: "new",
      at: "2026-10-09",
    };
    expect(mergeMemory(previous, [fresh, fresh])).toHaveLength(24);
    expect(mergeMemory(previous, [fresh], "old")).toEqual([fresh]);
  });
  it("accounts for cached reads and writes without assuming unknown prices", () => {
    expect(
      estimateCost("unknown", { input_tokens: 10, output_tokens: 10 }, {})
        .estimated_usd,
    ).toBeNull();
    expect(
      estimateCost("gpt-6-luna", {
        input_tokens: 1000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
      }).estimated_usd,
    ).toBeCloseTo(0.0001345);
    expect(
      estimateCost("gpt-6-luna", {
        input_tokens: 1,
        output_tokens: 1,
        input_tokens_details: { cached_tokens: 2 },
      }).estimated_usd,
    ).toBeNull();
  });
  it("accepts the old report price as well as the new price but never a subscription success page", () => {
    const session = {
      mode: "payment",
      payment_status: "paid",
      livemode: false,
      currency: "jpy",
      metadata: { payment_id: "p" },
    };
    for (const amount_total of [980, 1980])
      expect(
        paidSession({
          ...session,
          amount_total,
        } as unknown as Stripe.Checkout.Session),
      ).toBe(true);
    for (const amount_total of [0, 100, 1999])
      expect(
        paidSession({
          ...session,
          amount_total,
        } as unknown as Stripe.Checkout.Session),
      ).toBe(false);
    expect(
      paidSession({
        ...session,
        amount_total: 980,
        mode: "subscription",
      } as unknown as Stripe.Checkout.Session),
    ).toBe(false);
  });
  it("never fabricates conversion rates when the denominator is absent", () => {
    expect(ratio(0, 0)).toContain("計測中");
    expect(ratio(1, 4)).toContain("25.0%");
  });
});
