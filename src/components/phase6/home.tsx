import Link from "next/link";
import {
  ChatCircleDots,
  Heart,
  Users,
  ArrowsClockwise,
  ClipboardText,
  ClockCounterClockwise,
  ArrowRight,
  CaretRight,
} from "@phosphor-icons/react/dist/ssr";
import { topics } from "@/lib/trial/topics";
const worries = [
  ["reply", "返信が遅い、続かないなど", ChatCircleDots],
  ["crush", "気持ちを伝えるか迷っている", Heart],
  ["distance", "最近、少しすれ違っている", Users],
  ["reunion", "これからの向き合い方を考えたい", ArrowsClockwise],
] as const;
export default function Home() {
  return (
    <main id="main" className="p6-main">
      <div className="p6-home-grid">
        <section className="p6-hero">
          <p className="p6-eyebrow">あなたのペースで、一歩ずつ。</p>
          <h1>
            いまの気持ちから、
            <br />
            話してみませんか。
          </h1>
          <p>うまくまとまっていなくても、大丈夫。</p>
          <Link className="p6-button p6-hero-button" href="/chat">
            <ChatCircleDots size={28} aria-hidden />
            すぐ相談する
            <ArrowRight size={20} aria-hidden />
          </Link>
          <p className="p6-small p6-center">
            登録なし・1回答無料。診断は不要です。
          </p>
          <div className="p6-reassurance p6-desktop">
            <h2>
              相手の気持ちを決めつけず、
              <br />
              あなたが次の一歩を選ぶために。
            </h2>
            <p className="p6-small">まずは一言から。話しながら整理できます。</p>
          </div>
        </section>
        <section>
          <h2 className="p6-section-title">悩みから選ぶ</h2>
          <div className="p6-worries">
            {worries.map(([id, sub, Icon]) => (
              <Link href={"/chat?topic=" + id} className="p6-row" key={id}>
                <Icon size={26} aria-hidden />
                <span>
                  <strong>{topics[id].name}</strong>
                  <small>{sub}</small>
                </span>
                <CaretRight size={18} aria-hidden />
              </Link>
            ))}
          </div>
          <div className="p6-secondary">
            <Link className="p6-row p6-soft" href="/diagnosis/partner-mind">
              <ClipboardText size={26} aria-hidden />
              <span>
                <strong>じっくり無料診断</strong>
                <small>12〜18問・登録不要</small>
              </span>
              <CaretRight size={18} aria-hidden />
            </Link>
            <Link className="p6-row p6-soft" href="/consult">
              <ClockCounterClockwise size={26} aria-hidden />
              <span>
                <strong>前回の続きから</strong>
                <small>ログインして履歴を見る</small>
              </span>
              <CaretRight size={18} aria-hidden />
            </Link>
          </div>
        </section>
      </div>
      <section className="p6-home-footer">
        <div>
          <h2>必要なときに、必要な分だけ。</h2>
          <p className="p6-small">
            無料で始める · 単発レポート980円 · Plus月額980円
          </p>
        </div>
        <Link href="/plans">
          料金の違いを見る <ArrowRight size={18} aria-hidden />
        </Link>
      </section>
      <p className="p6-small">
        AIは相手の本心を断定しません。気持ちを整理するためのサポートです。
      </p>
    </main>
  );
}
