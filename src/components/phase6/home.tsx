import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ChatCircleDots,
  BookOpen,
  ClockCounterClockwise,
} from "@phosphor-icons/react/dist/ssr";
import { pricing, yen } from "@/lib/pricing";
import { topics } from "@/lib/trial/topics";
import { homeSample } from "@/lib/home-sample";

export default function Home({
  trialEnabled = false,
  freeLimit,
}: {
  trialEnabled?: boolean;
  freeLimit?: number;
}) {
  return (
    <main id="main" className="yorisoi-home">
      <section className="home-hero" aria-labelledby="home-heading">
        <div className="home-art">
          <Image
            src="/images/yorisoi-garden.webp"
            width={853}
            height={700}
            alt="木漏れ日の庭で、距離を取りながら向き合う二人の水彩画"
            preload
            unoptimized
          />
        </div>
        <div className="home-introduction">
          <p className="home-kicker">恋愛や人間関係を、AIと整理する</p>
          <h1 id="home-heading">
            その気持ち、
            <br />
            ここで話そう。
          </h1>
          <p className="home-description">
            言葉にしながら、
            <br className="home-mobile-break" />
            次の一歩を一緒に考える。
          </p>
          <Link
            className="button home-primary"
            href={trialEnabled ? "/chat" : "/consult"}
          >
            <ChatCircleDots size={26} aria-hidden />
            相談をはじめる
            <ArrowRight size={21} aria-hidden />
          </Link>
          <p className="home-conditions fine">
            {trialEnabled
              ? "登録なしのお試し相談が利用できます。"
              : "相談には無料登録・ログインが必要です。"}
            {freeLimit !== undefined
              ? ` 登録後は月${freeLimit}往復まで無料。`
              : " 無料範囲は料金ページで確認できます。"}
            無料プランでも履歴を引き継げます。
          </p>
        </div>
      </section>
      <nav className="home-entry-links" aria-label="相談の入口">
        <p>チャットで相談：自由に書いて、今の悩みや返信を整理</p>
        <ul>
          {(["reply", "crush", "distance", "reunion"] as const).map((id) => (
            <li key={id}>
              <Link
                href={(trialEnabled ? "/chat" : "/consult") + "?topic=" + id}
              >
                {topics[id].name}
              </Link>
            </li>
          ))}
        </ul>
        <div className="home-entry-actions">
          <Link href="/diagnosis/partner-mind">
            質問に答えて整理
            <ArrowRight size={18} aria-hidden />
          </Link>
          <Link href="/consult">
            前回の相談を続ける
            <ArrowRight size={18} aria-hidden />
          </Link>
        </div>
      </nav>
      <section className="home-answer" aria-labelledby="answer-heading">
        <h2 id="answer-heading">回答イメージ</h2>
        <div className="home-dialogue" aria-label="AIの回答例・サンプル">
          <div className="home-dialogue-row">
            <Image
              className="home-avatar"
              src="/images/yorisoi-question.webp"
              width={100}
              height={100}
              alt=""
              unoptimized
            />
            <div className="home-example home-question">
              <span className="sr-only">相談例：</span>
              <p>{homeSample.input}</p>
            </div>
          </div>
          <div className="home-dialogue-row">
            <Image
              className="home-avatar"
              src="/images/yorisoi-answer.webp"
              width={100}
              height={100}
              alt=""
              unoptimized
            />
            <div className="home-example home-ai">
              <span className="sr-only">AIの回答例：</span>
              <p>{homeSample.answer}</p>
              <p className="home-sample-next">{homeSample.nextStep}</p>
            </div>
          </div>
          <p className="fine home-sample-note">
            合成ケースの回答イメージ（抜粋）です。実利用者の相談や、人間の相談員による回答ではありません。
          </p>
        </div>
        <div className="home-diagnosis-intro">
          <p>相談は自由な文章で、診断は質問に答えながら状況を整理します。</p>
          <Link className="home-secondary" href="/diagnosis/partner-mind">
            質問に答えて整理
            <ArrowRight size={24} aria-hidden />
          </Link>
          <p>
            詳細レポート{yen(pricing.report)}（1回）・Plus月額
            {yen(pricing.plus)}
          </p>
        </div>
        <Image
          className="home-flowers"
          src="/images/yorisoi-flowers.webp"
          width={273}
          height={194}
          alt=""
          unoptimized
        />
      </section>
      <section className="home-offers" aria-labelledby="offer-heading">
        <div className="home-section-intro">
          <p className="home-kicker">必要なときに、必要な分だけ</p>
          <h2 id="offer-heading">相談の続け方を、選べます。</h2>
        </div>
        <dl className="home-price-list">
          <div>
            <dt>
              詳細レポート <span>1回のお支払い</span>
            </dt>
            <dd>
              <strong>{yen(pricing.report)}</strong>
              <span>（税込）</span>
              <p>
                今回の診断を、具体的な文面や行動プランまで整理。自動更新はありません。
              </p>
            </dd>
          </div>
          <div>
            <dt>
              Plus <span>月額プラン</span>
            </dt>
            <dd>
              <strong>月額{yen(pricing.plus)}</strong>
              <span>（税込）</span>
              <p>
                月の相談回数を増やすプラン。履歴の引き継ぎは無料プランでも利用でき、詳細レポートは別売です。
              </p>
            </dd>
          </div>
        </dl>
        <p>
          <Link className="button secondary" href="/report-sample">
            購入前に詳細レポートの見本を見る
          </Link>
        </p>
        <Link className="home-secondary" href="/plans">
          料金・利用条件を見る
          <ArrowRight size={20} aria-hidden />
        </Link>
      </section>
      <nav
        className="home-reading home-return-cards"
        aria-label="読みものと相談履歴"
      >
        <Link className="entry-card" href="/guides">
          <BookOpen size={28} aria-hidden />
          <h2>読みもの</h2>
          <span className="entry-kicker">言葉にする前に、読む。</span>
          <p>気持ちを整理するヒントを読む</p>
          <span className="entry-action">
            読みものを見る <ArrowRight size={20} aria-hidden />
          </span>
        </Link>
        <Link className="entry-card" href="/consult">
          <ClockCounterClockwise size={28} aria-hidden />
          <h2>前回の相談を続ける</h2>
          <span className="entry-kicker">あなたのペースで、続きから。</span>
          <p>これまでの話を振り返り、続きから相談</p>
          <span className="entry-action">
            相談履歴を開く <ArrowRight size={20} aria-hidden />
          </span>
        </Link>
      </nav>
      <p className="home-disclaimer fine">
        AIは相手の本心や将来を断定しません。あなたが次の一歩を選ぶためのサポートです。
      </p>
    </main>
  );
}
