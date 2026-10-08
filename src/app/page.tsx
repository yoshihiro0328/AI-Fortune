import Link from "next/link";
export const metadata = {
  alternates: { canonical: "/" },
  robots: {
    index: process.env.PUBLIC_INDEXING_ENABLED === "true",
    follow: process.env.PUBLIC_INDEXING_ENABLED === "true",
  },
};
const start = "/diagnosis/partner-mind";
export default function Home() {
  return (
    <main id="main">
      <section className="hero">
        <div className="eyebrow">ふたりのことを、ひとつずつ。</div>
        <h1>
          相手の気持ちが
          <br />
          分からない。
        </h1>
        <p className="lead">
          返信が遅くなった。前より距離を感じる。
          <br />
          でも、直接聞くのは少し怖い。
        </p>
        <p>
          今のやり取りを振り返って、
          <br />
          次にどうするか、一緒に整理してみませんか。
        </p>
        <Link className="button" href={start}>
          無料で今の状況を整理する
        </Link>
        <div className="meta">
          あなたのペースで <span>／</span> 登録不要
        </div>
        <p className="fine">
          相手の気持ちを決めつけず、あなたが次の一歩を選ぶために。
        </p>
      </section>
      <section className="intro wrap">
        <div>
          <span className="eyebrow">ひとりで考えすぎてしまうときに</span>
          <h2>
            今LINEしていい？
            <br />
            もう少し待った方がいい？
          </h2>
        </div>
        <div>
          <p>
            返事を待つ時間ほど、いろいろ考えてしまうもの。ひとつの反応だけで答えを出す前に、ふたりの今を振り返ってみましょう。
          </p>
          <ul className="worry-list">
            {[
              "相手からの連絡が、前より減った",
              "次に会う予定がなかなか決まらない",
              "付き合っているのに、少し距離を感じる",
              "片思いの相手の反応が分からない",
              "元恋人と、これからどう向き合うか迷う",
            ].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </section>
      <section className="wrap">
        <span className="eyebrow">無料で整理できること</span>
        <h2>
          良いところも、
          <br />
          気になることも。
        </h2>
        <div className="steps">
          {[
            [
              "01",
              "今の関係を振り返る",
              "ふたりの状況に合わせた質問で、最近のやり取りやあなたの気持ちを教えてください。うまく説明できなくても大丈夫です。",
            ],
            [
              "02",
              "分かることを整理する",
              "良い兆候、少し気になる変化、まだ分からないこと。期待にも不安にも偏らず、今の状況を見つめます。",
            ],
            [
              "03",
              "次にできることを考える",
              "一度聞いてみるか、少し待つか。あなたの回答に合わせて、次の一歩を考えるためのアドバイスを届けます。",
            ],
          ].map(([n, t, d]) => (
            <article key={n}>
              <span className="number">{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>
        <p className="fine">
          回答内容をもとにAIが状況を整理します。相手の本心や未来が分かるものではありません。
        </p>
      </section>
      <section className="wrap offer">
        <div>
          <span className="eyebrow">もう少し具体的に考えたいときに</span>
          <h2>
            何を伝えるか。
            <br />
            どう過ごしてみるか。
          </h2>
          <p>
            無料の結果を読んで、もう少し考えたいと思ったら。詳しいレポートでは、理由の整理から日々の行動まで一緒に見ていきます。
          </p>
          <ul>
            <li>相手の行動について考えられる、いくつかの理由</li>
            <li>連絡するタイミングと、送るLINE案3パターン</li>
            <li>次に会ったときの話し方や、避けたい行動</li>
            <li>7日・30日で無理なく試せる行動プラン</li>
          </ul>
        </div>
        <div>
          <p>あなたの回答に合わせた詳細レポート</p>
          <div className="price">
            1,980<span>円（税込）</span>
          </div>
          <p className="fine">
            購入は任意・1回のお支払い
            <br />
            自動更新なし／現在はテスト決済のみ
          </p>
          <Link href={start} className="button secondary">
            まずは無料で整理する
          </Link>
        </div>
      </section>
      <section className="wrap faq">
        <h2>使う前に、気になること。</h2>
        {[
          [
            "本当に無料ですか？",
            "はい。今の状況、良い兆候や気になる点、簡単なアドバイスは無料で読めます。詳細レポートは1,980円（税込）の任意購入です。現在はテスト決済のみです。",
          ],
          [
            "会員登録は必要ですか？",
            "無料の相談は登録せずに始められます。同じブラウザから結果を見返せます。別の端末でも見返したい場合は、メール認証後に診断をアカウントへ保存できます。",
          ],
          [
            "相手に知られますか？",
            "このサービスから相手へ連絡や通知を送ることはありません。共有している端末やブラウザの履歴から見られることはあるため、ご自身の端末でご利用ください。",
          ],
          [
            "入力した内容はどう扱われますか？",
            "診断内容は公開されません。AIによる分析のため、回答内容を外部サービス（OpenAI）で処理します。氏名・住所・電話番号・メールアドレスなど、個人を特定できる情報は入力しないでください。詳しくはプライバシーポリシーをご確認ください。",
          ],
          [
            "AIが相手の気持ちを断定するのですか？",
            "いいえ。教えていただいたやり取りをもとに、考えられる理由や、まだ分からないことを整理します。相手の本心や、関係がうまくいくかどうかは断定できません。",
          ],
          [
            "有料では何が増えますか？",
            "行動の理由をより詳しく整理し、連絡のタイミング、LINE案3パターン、次に会うときのヒント、7日・30日の行動プランをお届けします。無料の結果を読んでから選べます。",
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
      <section className="hero closing">
        <div className="eyebrow">あなたのペースで、一歩ずつ。</div>
        <h2>
          答えを急がず、
          <br />
          まずは今のことから。
        </h2>
        <Link className="button" href={start}>
          無料で今の状況を整理する
        </Link>
        <p className="fine">あなたのペースで・登録不要</p>
      </section>
    </main>
  );
}
