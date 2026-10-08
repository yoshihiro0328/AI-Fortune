import type { Metadata } from "next";
import Link from "next/link";
import Visit from "@/components/visit";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ||
      "https://partner-mind-vdiordna-2059.vercel.app",
  ),
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "よりそい",
    title: "よりそい | ふたりの今を整理する",
    description:
      "返信や距離感に迷ったら。ふたりの今と次の一歩を整理する、登録不要の恋愛相談。",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "よりそい | ふたりの今を整理する",
    images: ["/opengraph-image"],
  },
  title: {
    default: "よりそい | ふたりの今を整理する",
    template: "%s | よりそい",
  },
  description:
    "相手の気持ちが分からない。ふたりの今と次の一歩を整理してみませんか。あなたのペースで話せる、登録不要の恋愛相談。",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <a className="skip" href="#main">
          本文へ
        </a>
        <header>
          <Link className="brand" href="/">
            よりそい<span>YORISOI</span>
          </Link>
          <nav className="header-links">
            <Link className="nav-link" href="/account">
              マイページ
            </Link>
            <Link className="nav-link" href="/plans">
              料金
            </Link>
            <Link className="nav-link" href="/legal/ai">
              AI診断について
            </Link>
          </nav>
        </header>
        <Visit />
        {children}
        <footer>
          <div className="brand">
            よりそい<span>あなたのペースで、一歩ずつ。</span>
          </div>
          <nav>
            {[
              ["terms", "利用規約"],
              ["privacy", "プライバシー"],
              ["commerce", "特定商取引法"],
              ["refund", "返金・キャンセル"],
              ["ai", "AI利用について"],
              ["disclaimer", "免責事項"],
              ["advertising", "広告について"],
            ].map(([s, t]) => (
              <Link key={s} href={"/legal/" + s}>
                {t}
              </Link>
            ))}
            <Link href="/contact">お問い合わせ</Link>
            <Link href="/guides">恋愛相談の読みもの</Link>
            <Link href="/plans">料金・プラン</Link>
            <Link href="/safety">危険やつらさを感じるとき</Link>
          </nav>
          <small>テスト公開中。医療・心理療法の診断ではありません。</small>
        </footer>
      </body>
    </html>
  );
}
