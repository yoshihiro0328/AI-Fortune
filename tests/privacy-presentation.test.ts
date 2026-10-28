import { describe, it, expect } from "vitest";
import { privacyPresentation } from "../src/lib/privacy-presentation";
describe("policy preview does not promise an unconfigured production retention service", () => {
  it("shows approved durations only in isolated development", () => {
    const p = privacyPresentation({
      NODE_ENV: "development",
      LOCAL_REVIEW_ISOLATED: "true",
    });
    expect(p.retention).toContain("最終利用から1年");
    expect(p.retention).toContain("未完了診断は30日");
    expect(p.responseTime).toContain("2営業日以内");
    expect(p.local).toBe(true);
  });
  it("keeps production unconfigured even with the review flag", () => {
    const p = privacyPresentation({
      NODE_ENV: "production",
      LOCAL_REVIEW_ISOLATED: "true",
    });
    expect(p.local).toBe(false);
    expect(p.retention).toContain("公開準備中");
    expect(p.retention).not.toContain("1年");
  });
  it("uses explicitly configured public policy without inventing new periods", () => {
    const p = privacyPresentation({
      DATA_RETENTION_POLICY: "承認した公開用方針",
      SUPPORT_RESPONSE_TIME: "公開用の回答目安",
    });
    expect(p.retention).toBe("承認した公開用方針");
    expect(p.responseTime).toBe("公開用の回答目安");
  });
});
