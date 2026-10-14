"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { exchangeExplanation } from "@/lib/display-copy";
import { request } from "@/lib/client";
import {
  subscriptionDisplay,
  japanDate,
} from "@/lib/consultation/subscription-display";
import type { ConsultationHome } from "@/lib/consultation/model";
export default function ConsultationSummary() {
  const [data, setData] = useState<ConsultationHome | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(await request<ConsultationHome>("/api/consultations"));
  }
  useEffect(() => {
    void request("/api/billing")
      .then(load)
      .catch(() => load().catch((e) => setError(e.message)));
  }, []);
  async function billing(action: string) {
    setBusy(true);
    setError("");
    try {
      const r = await request<{ url?: string }>("/api/billing", { action });
      if (r.url) location.assign(r.url);
      else {
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return <p role="status">{error || "相談の続きを読み込んでいます…"}</p>;
  const sub = data.subscription;
  const display = sub ? subscriptionDisplay(sub, data.usage.plan) : null;
  return (
    <section className="panel consultation-summary">
      <p className="eyebrow">続きから話せる場所</p>
      <h2>その後、どうなりましたか。</h2>
      <p>新しくあったことや、まだ迷っていることから話せます。</p>
      <Link
        className="button"
        href={
          data.threads[0] ? "/consult?thread=" + data.threads[0].id : "/consult"
        }
      >
        前回の続きから相談する
      </Link>
      <p>
        {data.usage.plan === "plus" ? "よりそい Plus" : "無料プラン"} · 残り
        <strong>{data.usage.remaining}往復</strong> / {data.usage.limit}往復
      </p>
      <p className="fine">{exchangeExplanation}</p>
      <p className="fine">
        利用期間：
        {japanDate(data.usage.period_start)}〜{japanDate(data.usage.period_end)}
        の直前まで
      </p>
      {data.subjects.slice(0, 4).map((s) => (
        <div className="history-row" key={s.id}>
          <Link
            href={
              "/consult" +
              (data.threads.find((t) => t.subject_id === s.id)
                ? "?thread=" +
                  data.threads.find((t) => t.subject_id === s.id)!.id
                : "")
            }
          >
            {s.nickname}
          </Link>
          <span>
            {
              s.memory
                .filter((f) => f.kind === "event" || f.kind === "concern")
                .at(-1)?.quote
            }
          </span>
        </div>
      ))}
      {sub && display && (
        <div className="billing-status">
          <h3>契約状況</h3>
          <p>
            月額{sub.amount.toLocaleString("ja-JP")}円（税込） ·{" "}
            {display.status}
          </p>
          {display.date && (
            <p>
              {display.dateLabel}：{display.date}（日本時間）
            </p>
          )}
          {["active", "past_due"].includes(sub.status) &&
            !sub.cancel_at_period_end &&
            !sub.cancel_at && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "次回の自動更新を停止します。表示された利用期限まではPlusを使えます。返金の申請とは別の手続きです。",
                    )
                  )
                    void billing("cancel");
                }}
              >
                次回の自動更新を停止する
              </button>
            )}
        </div>
      )}
      <div className="actions">
        <Link href="/plans">プランを確認する・再契約</Link>
        {data.hasBilling && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => billing("portal")}
          >
            解約・支払い方法・請求履歴
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="fine">
        現在はテスト決済のみで実請求は発生しません。Plusには単発の詳細診断は含まれません。
      </p>
    </section>
  );
}
