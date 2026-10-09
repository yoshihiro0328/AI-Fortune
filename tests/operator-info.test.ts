import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getOperatorConfig } from "../src/lib/operator";

vi.mock("@/lib/service-settings", () => ({
  serviceSettings: async () => ({ free_limit: 3, plus_limit: 30 }),
}));
const env = {
  OPERATOR_NAME: "テスト運営会社",
  OPERATOR_REPRESENTATIVE: "テスト責任者",
  OPERATOR_ADDRESS: "テスト所在地",
  OPERATOR_PHONE: "03-0000-0000",
  OPERATOR_EMAIL: "operator@example.test",
  DATA_RETENTION_POLICY: "診断データは最終利用から1年を目安に保存します。",
  REFUND_REQUEST_PERIOD: "決済完了後のお客様都合の返金は原則お受けしません",
  SUPPORT_RESPONSE_TIME: "原則3営業日以内",
};
const slugs = [
  "terms",
  "privacy",
  "commerce",
  "refund",
  "ai",
  "disclaimer",
  "advertising",
];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
function configure(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  vi.resetModules();
}
async function renderLegal(slug: string) {
  const { default: Legal } = await import("../src/app/legal/[slug]/page");
  return renderToStaticMarkup(
    await Legal({ params: Promise.resolve({ slug }) }),
  );
}
describe("operator information readiness", () => {
  it("recognizes all eight configured values and trims surrounding whitespace", () => {
    const config = getOperatorConfig({
      ...env,
      OPERATOR_NAME: "  テスト運営会社　",
    });
    expect(config.isComplete).toBe(true);
    expect(config.missingKeys).toEqual([]);
    expect(config.values.name).toBe(env.OPERATOR_NAME);
  });
  it.each(Object.keys(env))(
    "requires %s even when all other values exist",
    (key) => {
      for (const absent of [undefined, "", " \n　"]) {
        const config = getOperatorConfig({ ...env, [key]: absent });
        expect(config.isComplete).toBe(false);
        expect(config.missingKeys).toEqual([key]);
      }
    },
  );
  it.each(slugs)(
    "removes stale notices but keeps the test-payment disclosure on %s",
    async (slug) => {
      configure(env);
      const html = await renderLegal(slug);
      expect(html).not.toMatch(/未設定|TODO|暫定/);
      expect(html).toContain("現在はテスト決済のみで実請求は発生しません。");
      expect(html).toContain(env.SUPPORT_RESPONSE_TIME);
    },
  );
  it("shows the incomplete notice when just one field is blank", async () => {
    configure({ ...env, OPERATOR_PHONE: " " });
    expect(await renderLegal("terms")).toContain("運営者情報に未設定の項目");
  });
  it("renders configured identity, retention and refund policy without conflicting timing", async () => {
    configure(env);
    const commerce = await renderLegal("commerce");
    for (const key of [
      "OPERATOR_NAME",
      "OPERATOR_REPRESENTATIVE",
      "OPERATOR_ADDRESS",
      "OPERATOR_PHONE",
      "OPERATOR_EMAIL",
      "REFUND_REQUEST_PERIOD",
    ] as const)
      expect(commerce).toContain(env[key]);
    expect(await renderLegal("privacy")).toContain(env.DATA_RETENTION_POLICY);
    const refund = await renderLegal("refund");
    expect(refund).toContain(env.REFUND_REQUEST_PERIOD);
    expect(refund).not.toContain("提供後のお客様都合");
    expect(refund).toContain("重複課金");
    expect(refund).toContain("適用法令上の権利を制限するものではありません");
  });
  it("passes the configured response time to the contact page", async () => {
    configure(env);
    const { default: Page } = await import("../src/app/contact/page");
    expect(renderToStaticMarkup(createElement(Page))).toContain(
      env.SUPPORT_RESPONSE_TIME,
    );
  });
});
