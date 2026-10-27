import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReportContents from "../src/components/report-contents";
import fixture from "../scripts/phase6/payment-report-fixture.json";
import type { PaidReport } from "../src/lib/ai/schemas";
import { readFileSync } from "node:fs";

describe("readable report preserves source content and navigation", () => {
  it("links to all 13 unique items, grouped without dropping an original field", () => {
    const report = structuredClone(fixture) as PaidReport;
    report.messages = {
      natural: "補足：表示例。「文面1」",
      proactive: "補足：表示例。「文面2」",
      respectful_distance: "補足：表示例。「文面3」",
    };
    report.positive_signals = [
      { signal: "良い兆候の原文", reason: "良い理由の原文" },
    ];
    report.attention_signals = [
      { signal: "注意点の原文", reason: "注意の理由の原文" },
    ];
    const html = renderToStaticMarkup(
      createElement(ReportContents, { report }),
    );
    for (let i = 1; i <= 13; i++) {
      expect(html.match(new RegExp(`id="report-item-${i}"`, "g"))).toHaveLength(
        1,
      );
      expect(html).toContain(`href="#report-item-${i}"`);
    }
    for (const text of [
      report.relationship_analysis,
      report.behavior_patterns,
      report.contact_advice,
      report.next_meeting,
      report.overall_advice,
      ...report.distance_reasons,
      ...report.improvement_points,
      ...report.avoid_actions,
      "良い兆候の原文：良い理由の原文",
      "注意点の原文：注意の理由の原文",
    ])
      expect(html).toContain(text);
    expect(html).toContain("関係の整理");
    expect(html).toContain("連絡・メッセージ");
    expect(html).toContain("これからの行動");
    expect(html.match(/class="action-timeline"/g)).toHaveLength(2);
    // Source periods and actions are rendered in source order, never expanded to invented daily steps.
    for (const plan of [report.seven_day_plan, report.thirty_day_plan]) {
      let last = -1;
      for (const item of plan) {
        const index = html.indexOf(`<h4>${item.period}</h4>`, last + 1);
        expect(index).toBeGreaterThan(last);
        last = index;
      }
    }
    expect(html.match(/文面だけをコピー<\/button>/g)).toHaveLength(3);
  });
  it("retains every section for empty source fields without inventing advice", () => {
    const report = structuredClone(fixture) as PaidReport;
    report.distance_reasons = [];
    report.positive_signals = [];
    report.attention_signals = [];
    report.seven_day_plan = [];
    report.thirty_day_plan = [];
    report.relationship_analysis = "";
    const html = renderToStaticMarkup(
      createElement(ReportContents, { report }),
    );
    expect(html.match(/id="report-item-/g)).toHaveLength(13);
    expect(html).toContain("この項目の記載はありません。");
    expect(html).not.toContain('class="action-timeline"');
  });
  it("keeps save precautions and account controls separate from primary consultation", () => {
    const save = readFileSync("src/components/save-result-note.tsx", "utf8");
    for (const text of [
      "Cookie",
      "別のブラウザや端末",
      "URLの保存だけでは復元できません",
      "/account",
    ])
      expect(save).toContain(text);
    const account = readFileSync("src/components/account.tsx", "utf8");
    expect(account.indexOf("<ConsultationSummary")).toBeLessThan(
      account.indexOf('id="diagnosis-history"'),
    );
    expect(account.indexOf('id="diagnosis-history"')).toBeLessThan(
      account.indexOf('id="account-settings-title"'),
    );
  });
});
