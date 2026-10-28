import Link from "next/link";
import { guides } from "@/lib/guides";
export const metadata = {
  title: "恋愛相談の読みもの",
  description:
    "返信、片思い、復縁、マッチングアプリ。今の悩みを整理するための読みものです。",
  alternates: { canonical: "/guides" },
  robots: {
    index: process.env.PUBLIC_INDEXING_ENABLED === "true",
    follow: process.env.PUBLIC_INDEXING_ENABLED === "true",
  },
};
export default function Page() {
  return (
    <main id="main" className="wrap section reading-index">
      <p className="eyebrow">答えを急ぐ前に、ひとつずつ。</p>
      <h1>今の悩みに近い読みもの</h1>
      <p>
        相手の気持ちを決めつけず、分かっている出来事とあなたの希望から考えてみましょう。
      </p>
      <div className="reading-list">
        {guides.map((g, index) => (
          <article className="reading-entry" key={g.slug}>
            <span className="reading-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="eyebrow">
                {
                  [
                    "返信・LINE",
                    "連絡の距離感",
                    "会う時間",
                    "相手の反応",
                    "別れ・復縁",
                    "新しい出会い",
                    "恋人との関係",
                    "関係を話し合う",
                  ][index]
                }
              </p>
              <h2>{g.title}</h2>
              <p>{g.description}</p>
              <Link
                className="reading-open"
                href={"/guides/" + g.slug}
                aria-label={g.title + "を読む"}
              >
                記事を読む →
              </Link>
            </div>
          </article>
        ))}
      </div>
      <p>
        <Link
          className="button secondary"
          href="/diagnosis/partner-mind?source=guide"
        >
          自分の状況を無料で整理する
        </Link>
      </p>
    </main>
  );
}
