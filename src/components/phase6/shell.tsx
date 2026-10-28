"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  House,
  ChatCircleDots,
  Users,
  ClipboardText,
  CreditCard,
  UserCircle,
  BookOpen,
  Question,
  List,
  X,
} from "@phosphor-icons/react";

const links = [
  ["/", "ホーム", House],
  ["/chat", "チャットで相談", ChatCircleDots],
  ["/consult", "相談・履歴", Users],
  ["/diagnosis/partner-mind", "質問に答えて整理", ClipboardText],
  ["/account", "マイページ", UserCircle],
  ["/plans", "料金・プラン", CreditCard],
  ["/guides", "読みもの", BookOpen],
  ["/help", "ヘルプ・お問い合わせ", Question],
] as const;
const publicLinks = links.filter(([href]) =>
  ["/plans", "/guides", "/help"].includes(href),
);
export function isAppPage(path: string) {
  return (
    ["/chat", "/consult", "/account"].includes(path) ||
    ["/diagnosis/", "/result/", "/report/"].some((prefix) =>
      path.startsWith(prefix),
    )
  );
}
function selectedHref(path: string) {
  if (path.startsWith("/result/") || path.startsWith("/report/"))
    return "/diagnosis/partner-mind";
  if (path.startsWith("/guides/")) return "/guides";
  return path;
}
function Navigation({
  path,
  onNavigate,
  publicOnly = false,
}: {
  path: string;
  onNavigate?: () => void;
  publicOnly?: boolean;
}) {
  return (
    <nav aria-label="メインナビゲーション" className="site-navigation">
      {(publicOnly ? publicLinks : links).map(([href, title, Icon]) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          aria-current={
            selectedHref(path) === href
              ? path === href
                ? "page"
                : "location"
              : undefined
          }
        >
          <Icon size={22} aria-hidden />
          <span>{title}</span>
        </Link>
      ))}
    </nav>
  );
}
export default function Phase6Shell({
  children,
  demoHome = false,
}: {
  children: React.ReactNode;
  demoHome?: boolean;
}) {
  const pathname = usePathname();
  const path = demoHome ? "/" : pathname;
  const app = isAppPage(path),
    home = path === "/";
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();
  useEffect(() => {
    dialog.current?.close();
  }, [path]);
  useEffect(() => {
    const desktop = matchMedia("(min-width: 1000px)");
    const changed = () => {
      if (desktop.matches) dialog.current?.close();
    };
    desktop.addEventListener("change", changed);
    return () => desktop.removeEventListener("change", changed);
  }, []);
  const brand = (
    <Link className="p6-brand" href="/">
      よりそい<small>YORISOI</small>
    </Link>
  );
  const menu = (
    <>
      <button
        className="site-menu-trigger"
        ref={trigger}
        aria-expanded={open}
        aria-controls="site-menu-dialog"
        aria-haspopup="dialog"
        onClick={() => {
          dialog.current?.showModal();
          dialog.current?.scrollTo(0, 0);
          dialog.current?.querySelector(".site-menu-list")?.scrollTo(0, 0);
          setOpen(true);
        }}
      >
        <List size={22} aria-hidden />
        <span>メニュー</span>
      </button>
      <dialog
        ref={dialog}
        id="site-menu-dialog"
        className="site-menu-dialog"
        aria-labelledby="site-menu-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const items = event.currentTarget.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled])",
          );
          const first = items[0],
            last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className="site-menu-heading">
          <h2 id="site-menu-title">メニュー</h2>
          <button
            className="site-menu-close"
            onClick={close}
            aria-label="メニューを閉じる"
          >
            <X size={24} aria-hidden />
          </button>
        </div>
        <div className="site-menu-list">
          <Navigation path={path} onNavigate={close} />
        </div>
      </dialog>
    </>
  );
  if (!app)
    return (
      <div
        className={home ? "p6 yorisoi-home-shell site-public" : "site-public"}
      >
        <header
          className={
            home ? "home-header site-public-header" : "site-public-header"
          }
        >
          {brand}
          <div className="site-header-actions">
            <div className="site-public-desktop">
              <Navigation path={path} publicOnly />
            </div>
            <Link href="/account" className="site-login">
              ログイン
            </Link>
            {menu}
          </div>
        </header>
        {children}
      </div>
    );
  const title = path.startsWith("/result/")
    ? "診断結果"
    : path.startsWith("/report/")
      ? "詳細レポート"
      : (links.find(([href]) => href === path)?.[1] ?? "質問に答えて整理");
  return (
    <div className={`app-layout${path === "/chat" ? " app-chat-layout" : ""}`}>
      <aside className="app-sidebar" aria-label="サイト全体の移動">
        {brand}
        <p className="fine">あなたのペースで、一歩ずつ。</p>
        <Navigation path={path} />
      </aside>
      <div className="app-workspace">
        <header className="app-topbar">
          <span className="app-section-name">{title}</span>
          {menu}
        </header>
        <div className="app-content">
          {path === "/chat" ? <div className="p6">{children}</div> : children}
        </div>
      </div>
    </div>
  );
}
