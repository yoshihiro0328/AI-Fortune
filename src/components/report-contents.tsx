import type { PaidReport } from "@/lib/ai/schemas";
import MessageDrafts from "./message-drafts";

const titles = [
  "今のふたりの関係",
  "相手の行動パターン",
  "距離が変わった理由として考えられること",
  "良い兆候",
  "気に留めたいこと",
  "あなたが見直せること",
  "やらない方がいいこと",
  "今、連絡するか迷ったら",
  "次に送るメッセージ案",
  "次に会ったときのヒント",
  "今後7日間",
  "今後30日間",
  "総合アドバイス",
];
const chapters = [
  { title: "関係の整理", indices: [0, 3, 4, 1, 2] },
  { title: "連絡・メッセージ", indices: [7, 8] },
  { title: "これからの行動", indices: [5, 6, 9, 10, 11, 12] },
];
function Text({ value }: { value: string }) {
  return (
    <p className="report-prose">{value || "この項目の記載はありません。"}</p>
  );
}
function Items({ items }: { items: string[] }) {
  return items.length ? (
    <ul>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  ) : (
    <p className="fine">この項目の記載はありません。</p>
  );
}
function Plan({ items }: { items: PaidReport["seven_day_plan"] }) {
  return items.length ? (
    <ol className="action-timeline">
      {items.map((item, i) => (
        <li key={i}>
          <h4>{item.period}</h4>
          <p>{item.action}</p>
        </li>
      ))}
    </ol>
  ) : (
    <p className="fine">この項目の記載はありません。</p>
  );
}
export default function ReportContents({
  report,
  uncertainties,
}: {
  report: PaidReport;
  uncertainties?: string[];
}) {
  const content = [
    <Text key="relation" value={report.relationship_analysis} />,
    <Text key="behavior" value={report.behavior_patterns} />,
    <Items key="distance" items={report.distance_reasons} />,
    <Items
      key="positive"
      items={report.positive_signals.map((s) => s.signal + "：" + s.reason)}
    />,
    <Items
      key="attention"
      items={report.attention_signals.map((s) => s.signal + "：" + s.reason)}
    />,
    <Items key="improvement" items={report.improvement_points} />,
    <Items key="avoid" items={report.avoid_actions} />,
    <Text key="contact" value={report.contact_advice} />,
    <MessageDrafts key="messages" messages={report.messages} />,
    <Text key="meeting" value={report.next_meeting} />,
    <Plan key="seven" items={report.seven_day_plan} />,
    <Plan key="thirty" items={report.thirty_day_plan} />,
    <Text key="overall" value={report.overall_advice} />,
  ];
  return (
    <>
      <nav
        id="report-toc"
        className="report-toc"
        aria-label="詳細レポートの目次"
      >
        <h2>読みたいところから</h2>
        <p className="fine">
          3つの章・13項目。章を開くと、読みたい項目へ移動できます。
        </p>
        <div className="actions report-shortcuts" aria-label="次の行動への近道">
          <a className="button secondary" href="#report-item-8">
            今、連絡するか迷ったら
          </a>
          <a className="button secondary" href="#report-item-9">
            返信文の3案を見る
          </a>
          <a className="button secondary" href="#report-item-11">
            今後7日間の行動を見る
          </a>
        </div>
        <div className="report-toc-groups">
          {chapters.map((chapter) => (
            <details key={chapter.title}>
              <summary>{chapter.title}</summary>
              <ul>
                {chapter.indices.map((i) => (
                  <li key={i}>
                    <a href={`#report-item-${i + 1}`}>{titles[i]}</a>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </nav>
      {chapters.map((chapter, index) => (
        <section
          className="report-chapter"
          key={chapter.title}
          aria-labelledby={`chapter-${index}`}
        >
          <header>
            <p className="eyebrow">CHAPTER {index + 1}</p>
            <h2 id={`chapter-${index}`}>{chapter.title}</h2>
          </header>
          {chapter.indices.map((i) => (
            <section
              className="report-section"
              key={i}
              aria-labelledby={`report-item-${i + 1}`}
            >
              <h3 id={`report-item-${i + 1}`} tabIndex={-1}>
                {titles[i]}
              </h3>
              {content[i]}
            </section>
          ))}
          {index === 0 && (
            <aside className="notice report-unknown">
              <h3>まだ分からないこと</h3>
              <p className="fine">
                情報不足だけで悪い兆候とは判断しません。ここでは新しい分析を加えていません。
              </p>
              {uncertainties ? (
                <Items items={uncertainties} />
              ) : (
                <p>
                  このレポートには独立した不明点の項目がありません。本文中の条件・不確実性と、無料診断の結果を併せて確認してください。
                </p>
              )}
            </aside>
          )}
          <a className="back-to-toc button secondary" href="#report-toc">
            目次に戻る
          </a>
        </section>
      ))}
    </>
  );
}
