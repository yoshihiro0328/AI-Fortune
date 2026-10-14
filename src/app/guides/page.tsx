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
    <main id="main" className="wrap section">
      <p className="eyebrow">答えを急ぐ前に、ひとつずつ。</p>
      <h1>今の悩みに近い読みもの</h1>
      <p>
        相手の気持ちを決めつけず、分かっている出来事とあなたの希望から考えてみましょう。
      </p>
      <div className="guide-grid">
        {guides.map((g) => (
          <article className="guide-card" key={g.slug}>
            <h2>
              <Link href={"/guides/" + g.slug}>{g.title}</Link>
            </h2>
            <p>{g.description}</p>
          </article>
        ))}
      </div>
      <p>
        <Link href="/diagnosis/partner-mind?source=guide">
          自分の状況を無料で整理する
        </Link>
      </p>
    </main>
  );
}
