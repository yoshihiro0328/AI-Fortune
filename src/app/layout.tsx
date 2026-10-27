import { PaymentDisplayProvider } from "@/components/payment-display-provider";
import { paymentDisplayMode } from "@/lib/payment-display";
import type { Metadata } from "next";
import Link from "next/link";
import Visit from "@/components/visit";
import "./globals.css";
import "./phase6.css";
import "./demo.css";
import "./design.css";
import { demoEnabled } from "@/lib/demo/config";
import DemoBanner from "@/components/demo/banner";
import Phase6Shell from "@/components/phase6/shell";
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ||
      "https://partner-mind-vdiordna-2059.vercel.app",
  ),
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "よりそい",
    title: "よりそい | その気持ち、ここで話そう。",
    description:
      "恋愛や人間関係を、AIと整理する。言葉にしながら、次の一歩を一緒に考える。",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "よりそい | その気持ち、ここで話そう。",
    images: ["/opengraph-image"],
  },
  title: {
    default: "よりそい | その気持ち、ここで話そう。",
    template: "%s | よりそい",
  },
  description:
    "恋愛や人間関係を、AIと整理する。言葉にしながら、次の一歩を一緒に考える。",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const demo = demoEnabled();
  return (
    <html lang="ja">
      <body>
        <a className="skip" href="#main">
          本文へ
        </a>
        {demo && <DemoBanner />}
        <header className="legacy-header">
          <Link className="brand" href="/">
            よりそい<span>YORISOI</span>
          </Link>
          <nav className="header-links" aria-label="メインメニュー">
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
        {!demo &&
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.SUBSCRIPTION_INTEGRATION_LOCAL !== "true" &&
        !(
          process.env.PAYMENT_VERIFY_ONLY === "true" &&
          process.env.PAYMENT_INTEGRATION_LOCAL === "true"
        ) ? (
          <Visit />
        ) : null}
        <PaymentDisplayProvider mode={paymentDisplayMode(process.env)}>
          {demo ? children : <Phase6Shell>{children}</Phase6Shell>}
        </PaymentDisplayProvider>
        <footer className="site-footer">
          <div className="brand">
            よりそい<span>あなたのペースで、一歩ずつ。</span>
          </div>
          <div className="site-footer-groups">
            <nav aria-labelledby="footer-user-heading">
              <h2 id="footer-user-heading">利用者向け</h2>
              <ul>
                <li>
                  <Link href="/plans">料金・プラン</Link>
                </li>
                <li>
                  <Link href="/help">ヘルプ・お問い合わせ</Link>
                </li>
                <li>
                  <Link href="/safety">危険やつらさを感じるとき</Link>
                </li>
              </ul>
            </nav>
            <nav aria-labelledby="footer-legal-heading">
              <h2 id="footer-legal-heading">規約・運営情報</h2>
              <ul>
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
          </div>
          <small>医療・心理療法の診断ではありません。</small>
        </footer>
      </body>
    </html>
  );
}
