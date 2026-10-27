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
