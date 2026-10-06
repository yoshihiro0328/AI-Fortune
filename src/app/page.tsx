export const metadata = {
  alternates: { canonical: "/" },
  robots: {
    index: process.env.PUBLIC_INDEXING_ENABLED === "true",
    follow: process.env.PUBLIC_INDEXING_ENABLED === "true",
  },
};
import Link from "next/link";
export default function Home() {
  return (
    <main id="main">
      <section className="hero">
        <div className="eyebrow">ふたりのことを、ひとつずつ。</div>
        <p className="pill">AIで整理する、相手の心理診断</p>
        <h1>
          相手の気持ちが
          <br />
          分からない。
        </h1>
        <p className="lead">
          返信の間隔、会ったときの表情。
          <br />
          小さな変化に、ひとりで悩んでいませんか？
        </p>
        <p>今の状況をAIと一緒に整理してみませんか。</p>
        <Link className="button" href="/diagnosis/partner-mind">
          無料でAI診断する
        </Link>
        <div className="meta">
          無料 <span>／</span> 約3分 <span>／</span> 登録不要
        </div>
        <p className="fine">
          相手の気持ちを決めつけず、回答から考えられる可能性を整理します。
        </p>
      </section>
      <section className="intro wrap">
        <div>
          <span className="eyebrow">TAKE A BREATH</span>
          <h2>
            答えを急がず、
            <br />
            今の関係を見つめる。
          </h2>
        </div>
        <p>
          「脈があるか、ないか」だけでは、見えないことがあります。
          <br />
          <br />
          ふたりのやりとりを振り返り、良い兆候や気になる変化、まだ分からないことを整理。あなたが次の一歩を選ぶためのヒントを届けます。
        </p>
      </section>
      <section className="wrap">
        <span className="eyebrow">HOW IT WORKS</span>
        <h2>気持ちを整理する、3つのステップ</h2>
        <div className="steps">
          {[
            [
              "01",
              "今のことを話す",
              "約10問に答えるだけ。まとまっていなくても大丈夫です。",
            ],
            [
              "02",
              "関係を整理する",
              "良い兆候や注意点を、AIが複数の視点から整理します。",
            ],
            [
              "03",
              "次の一歩を選ぶ",
              "無料のアドバイスを受け取れます。詳しい行動プランは、ご希望の方だけ。",
            ],
          ].map(([n, t, d]) => (
            <article key={n}>
              <span className="number">{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="wrap offer">
        <div>
          <span className="eyebrow">A LITTLE MORE CLARITY</span>
          <h2>具体的に、どうすればいい？</h2>
          <p>
            もっと整理したいときには、あなたの回答に合わせた詳細レポートを。
          </p>
          <ul>
            <li>相手の行動について考えられる理由</li>
            <li>次に送るLINE案を3パターン</li>
            <li>7日・30日の行動プラン</li>
          </ul>
        </div>
        <div>
          <p>AI詳細恋愛診断</p>
          <div className="price">
            1,980<span>円（税込）</span>
          </div>
          <p className="fine">
            1回のお支払い・自動更新なし
            <br />
            現在はテスト決済のみ
          </p>
          <Link href="/diagnosis/partner-mind" className="button secondary">
            まずは無料で整理する
          </Link>
        </div>
      </section>
      <section className="wrap faq">
        <h2>安心して、ご利用いただくために。</h2>
        <details>
          <summary>相手の本当の気持ちが分かりますか？</summary>
          <p>
            いいえ。入力いただいた行動や状況から、複数の可能性を整理します。相手の心理や未来、関係の成功を保証するものではありません。
          </p>
        </details>
        <details>
          <summary>回答は公開されますか？</summary>
          <p>
            診断内容は公開されません。AIによる分析のため、回答内容を外部サービス（OpenAI）で処理します。氏名・住所・電話番号・メールアドレスなど、個人を特定できる情報は入力しないでください。
          </p>
        </details>
        <details>
          <summary>無料だけで利用できますか？</summary>
          <p>
            はい。状況の整理と簡単なアドバイスは無料です。詳細レポートの購入は任意です。
          </p>
        </details>
      </section>
    </main>
  );
}
