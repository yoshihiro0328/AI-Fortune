import type { Metadata } from "next";
import Link from "next/link";
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
    title: "よりそい | 相手の心理診断",
    description: "今の状況をAIと一緒に整理する、登録不要の恋愛相談。",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "よりそい | 相手の心理診断",
    images: ["/opengraph-image"],
  },
  title: { default: "よりそい | 相手の心理診断", template: "%s | よりそい" },
  description:
    "相手の気持ちが分からない。今の状況をAIと一緒に整理してみませんか。約3分、登録不要の恋愛相談。",
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
            <Link className="nav-link" href="/legal/ai">
              AI診断について
            </Link>
          </nav>
        </header>
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
          </nav>
          <small>テスト公開中。医療・心理療法の診断ではありません。</small>
        </footer>
      </body>
    </html>
  );
}
