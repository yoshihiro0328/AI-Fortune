import { privacyPresentation } from "@/lib/privacy-presentation";
import Link from "next/link";
import { publicContactEmail } from "@/lib/public-contact";

export const metadata = {
  title: "ヘルプ・お問い合わせ",
  alternates: { canonical: "/help" },
  robots: {
    index: process.env.PUBLIC_INDEXING_ENABLED === "true",
    follow: process.env.PUBLIC_INDEXING_ENABLED === "true",
  },
};
export default function Page() {
  return (
    <main id="main" className="flow help-page">
      <p className="eyebrow">困ったときはこちらから</p>
      <h1>ヘルプ・お問い合わせ</h1>
      <p>知りたいことや、お困りの内容からお選びください。</p>
      <nav className="help-section" aria-labelledby="help-actions-heading">
        <h2 id="help-actions-heading">ご利用中のお困りごと</h2>
        <ul className="help-links">
          <li>
            <Link href="/account">ログイン・診断履歴・契約を確認する →</Link>
          </li>
          <li>
            <Link href="/plans">料金・プランの違いを確認する →</Link>
          </li>
          <li>
            <Link href="/legal/refund">解約・返金について確認する →</Link>
          </li>
          <li>
            <Link href="/safety">危険やつらさを感じるとき →</Link>
          </li>
        </ul>
      </nav>
      <section className="help-section" aria-labelledby="faq-heading">
        <h2 id="faq-heading">よくある質問</h2>
        <details>
          <summary>どこまで無料？ 登録は必要？</summary>
          <p>
            初回診断は登録なしで利用できます。継続相談は無料登録・ログイン後、月の無料枠内で利用でき、無料プランでも履歴を引き継げます。登録なしのお試し相談は、提供中の場合にトップから案内します。
          </p>
          <Link className="button secondary" href="/plans">
            現在の無料回数と利用条件
          </Link>
        </details>
        <details>
          <summary>人が回答するサービスですか？</summary>
          <p>
            相談・診断・レポートの回答はAIが作成します。人間の相談員による相談や医療・専門的な判断ではなく、相手の本心や将来を保証しません。
          </p>
          <Link className="button secondary" href="/legal/ai">
            AI利用について
          </Link>
        </details>
        <details>
          <summary>相談内容はどう扱われますか？</summary>
          <p>
            回答に必要な内容を外部のAIサービスへ送信します。相談と履歴は相手ごとに管理します。実名や連絡先などは入力しないでください。
          </p>
          <Link className="button secondary" href="/legal/privacy">
            保存・削除とデータの扱い
          </Link>
        </details>
        <details>
          <summary>Plusに入ると詳細レポートも読めますか？</summary>
          <p>
            Plusは月の相談回数を増やすプランです。診断ごとの詳細レポートは別売で、レポートだけの購入に月額契約は不要です。
          </p>
          <Link className="button secondary" href="/report-sample">
            レポートの見本
          </Link>{" "}
          <Link className="button secondary" href="/plans">
            料金・プラン
          </Link>
        </details>
        <details>
          <summary>Plusはどう解約しますか？</summary>
          <p>
            マイページの契約管理から次回の自動更新を停止できます。解約手続き後も支払い済みの期間は利用できます。
          </p>
          <Link className="button secondary" href="/account">
            マイページ
          </Link>{" "}
          <Link className="button secondary" href="/legal/refund">
            解約・返金の詳しい条件
          </Link>
        </details>
      </section>
      <section
        id="data-deletion"
        className="help-section"
        aria-labelledby="data-deletion-title"
      >
        <h2 id="data-deletion-title">データの削除・退会を依頼する</h2>
        <ol>
          <li>
            相談画面では「呼び名・相談履歴を整理する」から、相談履歴だけ、または相手の相談データ全体を選んで削除できます。削除は取り消せません。引き継ぐメモも相談画面で確認・修正・削除できます。
          </li>
          <li>
            診断データの削除・退会は、お問い合わせフォームで希望する対象と登録メールアドレスをお知らせください。分かれば診断番号も添えてください。
          </li>
          <li>
            登録なしで利用した場合は、利用したブラウザのCookieを消さずにご連絡ください。診断番号だけでは本人確認になりません。パスワード・カード番号・本人確認書類は送らないでください。
          </li>
          <li>
            本人確認後に対象と影響を確認します。決済処理・法令・調査で必要な記録や、外部サービス・バックアップは扱いが異なるため、理由と期間を個別に確認します。
          </li>
        </ol>
        <p>{privacyPresentation(process.env).responseTime}</p>
        <div className="actions">
          <Link className="button secondary" href="/contact">
            削除・退会について問い合わせる
          </Link>
          <Link className="button secondary" href="/legal/privacy">
            保存・削除の詳しい方針
          </Link>
        </div>
      </section>
      <section className="help-section" aria-labelledby="help-contact-heading">
        <h2 id="help-contact-heading">解決しないときは</h2>
        <p>
          診断・購入・データの取り扱いについてお問い合わせいただけます。緊急の相談窓口ではありません。
        </p>
        <a className="contact-email" href={`mailto:${publicContactEmail}`}>
          {publicContactEmail}
        </a>
        <p className="fine">
          パスワード・カード番号・第三者の個人情報は送らないでください。
        </p>
        <Link className="button secondary" href="/contact">
          お問い合わせフォームへ
        </Link>
      </section>
      <nav className="help-section" aria-labelledby="help-policies-heading">
        <h2 id="help-policies-heading">サービスの説明・規約</h2>
        <ul className="help-links">
          <li>
            <Link href="/legal/ai">AI利用について</Link>
          </li>
          <li>
            <Link href="/legal/refund">返金・キャンセル</Link>
          </li>
          <li>
            <Link href="/legal/disclaimer">免責事項</Link>
          </li>
          <li>
            <Link href="/legal/advertising">広告について</Link>
          </li>
          <li>
            <Link href="/legal/terms">利用規約</Link>
          </li>
          <li>
            <Link href="/legal/privacy">プライバシー</Link>
          </li>
          <li>
            <Link href="/legal/commerce">特定商取引法に基づく表記</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
