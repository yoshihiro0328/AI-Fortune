"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  ChatCircleDots,
  Users,
  ClipboardText,
  ClockCounterClockwise,
  CreditCard,
  UserCircle,
} from "@phosphor-icons/react";
const links = [
  ["/", "ホーム", House],
  ["/chat", "すぐ相談", ChatCircleDots],
  ["/consult", "相手別ホーム", Users],
  ["/diagnosis/partner-mind", "無料診断", ClipboardText],
  ["/consult", "継続相談", ClockCounterClockwise],
  ["/plans", "料金・プラン", CreditCard],
  ["/account", "マイページ", UserCircle],
] as const;
export default function Phase6Shell({
  children,
  demoHome = false,
}: {
  children: React.ReactNode;
  demoHome?: boolean;
}) {
  const pathname = usePathname();
  // A rewritten demo homepage must render the same shell on server and client.
  const path = demoHome ? "/" : pathname;
  const chat = path === "/chat";
  const modern = path === "/" || chat;
  if (!modern) return children;
  if (path === "/")
    return (
      <div className="p6 yorisoi-home-shell">
        <header className="home-header">
          <Link className="p6-brand" href="/">
            よりそい<small>YORISOI</small>
          </Link>
          <nav aria-label="メインメニュー">
            <Link className="home-header-extra" href="/consult">
              相談履歴
            </Link>
            <Link className="home-header-extra" href="/plans">
              料金・プラン
            </Link>
            <Link href="/account">マイページ・ログイン</Link>
          </nav>
        </header>
        {children}
      </div>
    );
  return (
    <div className={`p6 ${chat ? "p6-chat-shell" : ""}`}>
      <aside className="p6-sidebar">
        <Link className="p6-brand" href="/">
          よりそい<small>YORISOI</small>
        </Link>
        <p className="p6-small">ふたりのことを、ひとつずつ。</p>
        <nav aria-label="メインナビゲーション">
          {links.map(([href, title, Icon]) => (
            <Link
              key={title}
              href={href}
              aria-current={path === href ? "page" : undefined}
            >
              <Icon size={23} aria-hidden />
              {title}
            </Link>
          ))}
        </nav>
        <div className="p6-sidebar-note">
          <p>
            あなたのペースで、
            <br />
            一歩ずつ。
          </p>
          <Link href="/legal/ai">よりそいについて</Link>
        </div>
      </aside>
      <div className="p6-workspace">
        <header className="p6-topbar">
          <Link className="p6-brand p6-mobile" href="/">
            よりそい<small>YORISOI</small>
          </Link>
          <span className="p6-desktop p6-small">
            ふたりのことを、ひとつずつ。　 / {chat ? "すぐ相談" : "ホーム"}
          </span>
          <nav aria-label="アカウント">
            <Link href="/plans">料金</Link>
            <Link href="/account">ログイン</Link>
          </nav>
        </header>
        {children}
      </div>
      {!chat && (
        <nav className="p6-bottom" aria-label="モバイルナビゲーション">
          {[links[0], links[1], links[2], links[6]].map(
            ([href, title, Icon]) => (
              <Link
                key={title}
                href={href}
                aria-current={path === href ? "page" : undefined}
              >
                <Icon size={23} aria-hidden />
                <span>
                  {title === "相手別ホーム"
                    ? "相手別"
                    : title === "すぐ相談"
                      ? "相談"
                      : title}
                </span>
              </Link>
            ),
          )}
        </nav>
      )}
    </div>
  );
}
