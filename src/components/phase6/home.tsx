import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChatCircleDots } from "@phosphor-icons/react/dist/ssr";
import { pricing, yen } from "@/lib/pricing";

export default function Home({
  trialEnabled = false,
}: {
  trialEnabled?: boolean;
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
        </div>
      </section>
      <section className="home-answer" aria-labelledby="answer-heading">
        <h2 id="answer-heading">回答のイメージ</h2>
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
              <p>なんて返信したらいい？</p>
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
              <p>
                まずは、あなたが伝えたい
                <br className="home-answer-break" />
                気持ちから整理してみましょう。
              </p>
            </div>
          </div>
          <p className="fine home-sample-note">
            AIの回答例・サンプルです。人間の相談員による回答ではありません。
          </p>
        </div>
        <div className="home-diagnosis-intro">
          <Link className="home-secondary" href="/diagnosis/partner-mind">
            じっくり診断する
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
              <p>履歴を踏まえて相談を続けるプラン。詳細レポートは別売です。</p>
            </dd>
          </div>
        </dl>
        <Link className="home-secondary" href="/plans">
          料金・利用条件を見る
          <ArrowRight size={20} aria-hidden />
        </Link>
      </section>
      <nav className="home-reading" aria-label="読みものと相談履歴">
        <div>
          <p className="home-kicker">ひと息つきながら</p>
          <h2>言葉にする前に、読む。</h2>
          <Link className="home-guides-link" href="/guides">
            恋愛相談の読みもの
            <ArrowRight size={20} aria-hidden />
          </Link>
        </div>
        <Link className="home-secondary" href="/consult">
          前回の相談を続ける
          <ArrowRight size={20} aria-hidden />
        </Link>
      </nav>
      <p className="home-disclaimer fine">
        AIは相手の本心や将来を断定しません。あなたが次の一歩を選ぶためのサポートです。
      </p>
    </main>
  );
}
