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
          <summary>回答が届かないとき</summary>
          <p>
            まず通信状態と画面の「回答を準備中」などの表示を確認してください。回答待ちの間は新しい相談を重ねて送らないでください。相談・履歴では元の会話を開き、画面に復旧用の操作が出ている場合に限り、その同じ相談の操作を使います。
          </p>
          <p>
            登録なしの相談は、元のブラウザで開いてください。結果が分からないまま別の相談として送り直さず、表示が変わらない場合はお問い合わせください。相談本文や秘密情報は問い合わせに貼り付けないでください。
          </p>
          <div className="actions">
            <Link className="button secondary" href="/consult">
              相談・履歴を開く
            </Link>
            <Link className="button secondary" href="/contact">
              問い合わせる
            </Link>
          </div>
        </details>
        <details>
          <summary>購入済みなのにレポートを開けないとき</summary>
          <p>
            再購入せず、購入時と同じブラウザ・アカウントで、マイページの「詳細レポートを読む」を開いてください。作成中なら完了を待ちます。未保存の場合はCookieを削除しないでください。
          </p>
          <p>
            購入済みの表示と閲覧状態が一致しない場合は、診断番号と表示されたエラーをお問い合わせください。カード番号・パスワードは不要です。
          </p>
          <Link className="button secondary" href="/account#diagnosis-history">
            診断・購入済みレポートを確認
          </Link>
        </details>
        <details>
          <summary>認証メールが来ないとき</summary>
          <p>
            入力したアドレス、迷惑メールフォルダ、受信拒否設定を確認してください。送信中や受付完了の直後に繰り返し送らず、マイページの表示を確認します。再送が必要な場合は「確認メールを再送」から手続きできます。届いたリンクは手続きを始めたブラウザで開いてください。
          </p>
          <p>
            メール送信が無効・準備中と表示されている場合は、再送しても解決しません。問い合わせ先へ状況をお知らせください。
          </p>
          <Link className="button secondary" href="/account">
            マイページで確認
          </Link>
        </details>
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
