import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
import Plans from "../src/components/plans";
import BillingTerms from "../src/components/billing-terms";
import DiagnosisProgress from "../src/components/diagnosis-progress";
import Shell from "../src/components/phase6/shell";
import { homeSample } from "../src/lib/home-sample";
const render = renderToStaticMarkup;
describe("presentation preserves purchase conditions and honest progress", () => {
  it("matches plan action labels to existing destinations and keeps checkout consent", () => {
    const html = render(createElement(Plans, { free: 5, plus: 50 }));
    expect(html).toMatch(
      /href="\/diagnosis\/partner-mind"[^>]*>無料診断をはじめる/,
    );
    expect(html).toMatch(/href="\/account"[^>]*>マイページで診断履歴を見る/);
    expect(html).not.toContain("詳細診断");
    expect(html).toContain('type="checkbox"');
    expect(html).toMatch(/<button[^>]*disabled=""/);
    const outsideDetails = html.replace(/<details[\s\S]*?<\/details>/g, "");
    for (const text of [
      "月50往復",
      "毎月自動更新",
      "支払い済みの期間",
      "詳細レポートは含まれません",
      "自動更新なし",
      "980円",
    ])
      expect(outsideDetails).toContain(text);
  });
  it("collapses only supplemental counting text on plans, keeps the full legal view", () => {
    const compact = render(
      createElement(BillingTerms, { free: 5, plus: 50, compact: true }),
    );
    const full = render(createElement(BillingTerms, { free: 5, plus: 50 }));
    expect(compact).toContain("<summary>相談回数の数え方と更新日</summary>");
    expect(compact).toContain('id="renewal-and-cancellation"');
    expect(full).not.toContain("<details");
    expect(full).toContain('id="plans-and-prices"');
    expect(compact).toContain("重複して数えません");
  });
  it("does not present an expanding question list as a fixed total or time estimate", () => {
    for (const count of [10, 17, 20]) {
      const html = render(
        createElement(DiagnosisProgress, {
          index: 4,
          count,
          phase: "relationship",
          dynamic: true,
          followup: false,
        }),
      );
      expect(html).toContain("第5問");
      expect(html).toContain(`現在用意されている質問は${count}問`);
      expect(html).toContain("総数ではありません");
      expect(html).not.toContain("分");
      expect(html).toContain('aria-label="診断の段階"');
    }
    expect(
      render(
        createElement(DiagnosisProgress, {
          index: 0,
          count: 2,
          dynamic: false,
          followup: true,
        }),
      ),
    ).toContain("追加確認の第1問");
  });
  it("has one consultation/history entry in the desktop navigation and the same mobile name", () => {
    const html = render(createElement(Shell, null, ""));
    const nav = html.match(
      /<nav aria-label="メインナビゲーション">([\s\S]*?)<\/nav>/,
    )![1];
    expect(nav.match(/href="\/consult"/g)).toHaveLength(1);
    expect(nav).toContain("相談・履歴");
    expect(html).not.toContain("相手別ホーム");
  });
  it("uses a fictional matching question and cautious concrete action", () => {
    expect(homeSample.input).toContain("昨日質問を送ってまだ返事がない");
    expect(homeSample.answer).toContain(
      "昨日送った質問への返事を待っているなら",
    );
    expect(homeSample.answer).toContain("理由まではまだ分かりません");
    expect(homeSample.nextStep).toContain("急ぎの用件なら");
  });
});
