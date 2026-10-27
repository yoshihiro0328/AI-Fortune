"use client";
import { useEffect, useRef, useState } from "react";
export default function LocalReviewBanner() {
  const [mode, setMode] = useState("free");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    fetch("/__review/health")
      .then((r) => r.json())
      .then((x) => setMode(x.mode))
      .catch(() => {});
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--review-banner-height",
        `${el.getBoundingClientRect().height}px`,
      ),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <aside
      ref={ref}
      style={{
        background: "#eaf5f1",
        color: "#183f36",
        padding: "10px 20px",
        borderBottom: "1px solid #9fbfb1",
        position: "relative",
        top: 0,
        zIndex: 100,
      }}
      aria-label="ローカル確認環境"
    >
      <style>{`@media(min-width:1000px){.p6-sidebar{top:var(--review-banner-height,90px)!important}}.p6-chat{height:calc(var(--trial-height,100dvh) - var(--review-banner-height,90px))}`}</style>
      <strong>
        最新画面のローカル確認 · 合成データ · 実AI／購入／メールは停止中
      </strong>
      <details>
        <summary style={{ cursor: "pointer", padding: "5px 0" }}>
          画面の切り替え・合成データの説明
        </summary>
        <p style={{ margin: "6px 0" }}>
          外部DBへの送信も停止中です。回答は固定の表示例です。入力はこのMacのメモリだけに保持され、再起動・状態切替で消えます。本物の個人情報やパスワードは入力しないでください。
        </p>
        <nav
          style={{ display: "flex", gap: 14, flexWrap: "wrap" }}
          aria-label="確認画面"
        >
          {[
            ["/", "ホーム"],
            ["/chat", "すぐ相談"],
            ["/diagnosis/partner-mind?new=1", "診断"],
            ["/result/sample-result", "診断結果"],
            ["/report/sample-result", "詳細レポート"],
            ["/consult", "相談・履歴"],
            ["/plans", "料金"],
            ["/account", "マイページ"],
            ["/guides", "読みもの"],
            ["/contact", "問い合わせ"],
          ].map(([href, title]) => (
            <a key={href} href={href}>
              {title}
            </a>
          ))}
        </nav>
        <form
          action="/__review/scenario"
          method="post"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 8,
          }}
        >
          <label htmlFor="review-mode">合成アカウントの表示</label>
          <select
            id="review-mode"
            name="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            style={{ width: "auto" }}
          >
            <option value="free">無料会員</option>
            <option value="plus">Plus</option>
            <option value="scheduled">解約予約・Plus</option>
            <option value="empty">履歴なし・無料</option>
            <option value="canceled">解約後・Free</option>
            <option value="anonymous">未ログイン</option>
          </select>
          <button type="submit" style={{ padding: "5px 12px" }}>
            切り替えてマイページを見る
          </button>
        </form>
        <small>
          最新コードの画面部品を使用。質問分岐・回答・権限は合成で、実サービスの動作証明ではありません。運営方針の文面には未確定部分があります。
        </small>
      </details>
    </aside>
  );
}
