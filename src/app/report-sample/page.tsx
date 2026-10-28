import Link from "next/link";
import MessageDrafts from "@/components/message-drafts";
import { reportSample as sample } from "@/lib/report-sample";
import { pricing, yen } from "@/lib/pricing";
export const metadata = {
  title: "詳細レポートの見本",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <main id="main" className="flow report paid-report report-sample">
      <p className="eyebrow">購入前に読める、合成例</p>
      <h1>詳細レポートの見本</h1>
      <p className="notice">
        架空の相談を使った見本です。メッセージは保存済み合格サンプルの抜粋、関係整理と行動プランは表示用の編集例です。実利用者の相談ではなく、すべての回答や結果を保証するものではありません。
      </p>
      <section className="report-section">
        <h2>例の相談内容</h2>
        <p>{sample.input}</p>
      </section>
      <section className="report-section">
        <h2>関係の整理</h2>
        <p>{sample.relationship}</p>
      </section>
      <section className="report-section">
        <h2>送るメッセージ3案</h2>
        <p>
          今の状況と、自分が伝えたいことに合う案を選びます。補足はコピーに含めません。
        </p>
        <MessageDrafts messages={sample.messages} />
      </section>
      {[
        ["今後7日間", sample.week],
        ["今後30日間", sample.month],
      ].map(([title, items]) => (
        <section className="report-section" key={title as string}>
          <h2>{title as string}の行動プラン</h2>
          <ol className="action-timeline">
            {(items as typeof sample.week).map((item) => (
              <li key={item.period}>
                <h3>{item.period}</h3>
                <p>{item.action}</p>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <section className="notice">
        <h2>詳細レポートとPlusの違い</h2>
        <p>
          詳細レポートは診断ごとに{yen(pricing.report)}
          （税込）で購入する13項目のレポートです。自動更新はありません。このページは一部の見本です。
        </p>
        <p>
          Plusは月額{yen(pricing.plus)}
          （税込）で相談回数を増やす自動更新プランです。詳細レポートは含まれず、別売です。
        </p>
        <Link className="button secondary" href="/plans">
          料金・回数・購入条件を見る
        </Link>
      </section>
      <div className="actions">
        <Link className="button" href="/diagnosis/partner-mind">
          無料診断をはじめる
        </Link>
        <Link className="button secondary" href="/">
          トップに戻る
        </Link>
      </div>
    </main>
  );
}
