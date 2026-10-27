import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../src/components/phase6/home";
import { pricing, yen } from "../src/lib/pricing";

describe("home offer and consultation presentation", () => {
  it("routes a paused trial to authenticated consultation instead of promising a free trial", () => {
    const html = renderToStaticMarkup(
      createElement(Home, { trialEnabled: false }),
    );
    expect(html).toMatch(/href="\/consult"[^>]*>.*?相談をはじめる/s);
    expect(html).not.toContain('href="/chat"');
    expect(html).not.toContain("登録不要");
    expect(html).not.toContain("無料");
  });
  it("keeps the enabled trial, separate report and recurring offer, and sample disclosure", () => {
    const html = renderToStaticMarkup(
      createElement(Home, { trialEnabled: true }),
    );
    expect(html).toMatch(/href="\/chat"[^>]*>.*?相談をはじめる/s);
    expect(html).toContain(yen(pricing.report));
    expect(html).toContain(`月額${yen(pricing.plus)}`);
    expect(html).toContain("自動更新はありません");
    expect(html).toContain("詳細レポートは別売");
    expect(html).toContain("人間の相談員による回答ではありません");
    expect(html).toContain('href="/diagnosis/partner-mind"');
    expect(html).toContain('href="/guides"');
  });
});
