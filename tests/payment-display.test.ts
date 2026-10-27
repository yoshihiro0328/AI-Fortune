import { describe, expect, it } from "vitest";
import { paymentDisplay, paymentDisplayMode } from "@/lib/payment-display";
import { productionIssues } from "@/lib/production/config";
describe("payment display and explicit production destination", () => {
  it("never promises no real charge for live, unknown, or misconfigured production", () => {
    for (const env of [
      { VERCEL_ENV: "production", STRIPE_MODE: "live" },
      {
        VERCEL_ENV: "production",
        STRIPE_MODE: "sandbox",
        LOCAL_REVIEW_ISOLATED: "true",
      },
      {},
    ])
      expect(paymentDisplay(paymentDisplayMode(env)).notice).not.toContain(
        "実請求は発生しません",
      );
    expect(paymentDisplayMode({ LOCAL_REVIEW_ISOLATED: "true" })).toBe(
      "synthetic",
    );
    expect(
      paymentDisplay(paymentDisplayMode({ STRIPE_MODE: "sandbox" })).notice,
    ).toContain("実請求は発生しません");
  });
  it("accepts only the explicitly bound origin and hosting project, including a dedicated Vercel hostname", () => {
    const env = {
      NODE_ENV: "test" as const,
      NEXT_PUBLIC_APP_URL: "https://fixture-production.vercel.app",
      PRODUCTION_PUBLIC_ORIGIN: "https://fixture-production.vercel.app",
      PRODUCTION_VERCEL_PROJECT_ID: "prj_fixture",
      VERCEL_PROJECT_ID: "prj_fixture",
    };
    expect(productionIssues(env)).not.toContain("PUBLIC_ORIGIN");
    expect(productionIssues(env)).not.toContain("HOSTING_PROJECT_BINDING");
    expect(
      productionIssues({
        ...env,
        NEXT_PUBLIC_APP_URL: "https://old-review.vercel.app",
      }),
    ).toContain("PUBLIC_ORIGIN");
    expect(
      productionIssues({ ...env, VERCEL_PROJECT_ID: "prj_other" }),
    ).toContain("HOSTING_PROJECT_BINDING");
    expect(
      productionIssues({ ...env, PRODUCTION_PUBLIC_ORIGIN: undefined }),
    ).toContain("PUBLIC_ORIGIN");
    expect(
      productionIssues({ ...env, PRODUCTION_VERCEL_PROJECT_ID: undefined }),
    ).toContain("HOSTING_PROJECT_BINDING");
    for (const bad of [
      "http://example.org",
      "https://example.org/path",
      "https://example.org:8443",
      "https://user:pass@example.org",
      "https://example.org?x=1",
    ])
      expect(
        productionIssues({
          ...env,
          NEXT_PUBLIC_APP_URL: bad,
          PRODUCTION_PUBLIC_ORIGIN: bad,
        }),
      ).toContain("PUBLIC_ORIGIN");
  });
});
