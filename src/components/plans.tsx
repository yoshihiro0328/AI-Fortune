"use client";
import { useState } from "react";
import Link from "next/link";
import { request } from "@/lib/client";
import BillingTerms from "./billing-terms";
import { testPaymentNotice } from "@/lib/display-copy";
import { pricing, yen } from "@/lib/pricing";
export default function Plans({ free, plus }: { free: number; plus: number }) {
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function checkout() {
    setBusy(true);
    setError("");
    try {
      const r = await request<{ url: string }>("/api/billing", {
        action: "checkout",
        consent,
      });
      location.assign(r.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="plan-grid">
        <section className="plan-card">
          <p className="eyebrow">まずは、気軽に</p>
          <h2>無料プラン</h2>
          <p className="price">
            0<span>円</span>
          </p>
          <p>
            登録不要の初回診断。登録後は月{free}
            回、前の話の続きから相談できます。
          </p>
          <ul>
            <li>状況に合わせた無料診断と結果</li>
            <li>相手ごとに前の話を引き継ぐ相談</li>
            <li>診断・相談履歴の閲覧</li>
          </ul>
          <Link className="button secondary" href="/diagnosis/partner-mind">
            無料で相談してみる
          </Link>
        </section>
        <section className="plan-card">
          <p className="eyebrow">出来事があったときに、また</p>
          <h2>よりそい Plus</h2>
          <p className="price">
            {yen(pricing.plus)}
            <span> / 月（税込）</span>
          </p>
          <p>月{plus}回、同じ相手の話を引き継ぎながら相談できます。</p>
          <ul>
            <li>以前の話を踏まえたAIチャット</li>
            <li>LINE返信文面の作成</li>
            <li>状況の変化・次の行動の相談</li>
          </ul>
          <p className="fine">
            詳細診断は含まれません。別途{yen(pricing.report)}（税込）です。
          </p>
          <label className="choice">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            月額{yen(pricing.plus)}
            （税込）で、解約するまで毎月自動更新します。マイページから次回の更新を停止できることを確認しました。現在はテスト決済のみで実請求は発生しません。
          </label>
          <button
            className="button"
            disabled={busy || !consent}
            onClick={checkout}
          >
            {busy ? "手続き画面を開いています…" : "Plusのテスト契約へ"}
          </button>
          <p className="fine">
            登録後、メールアドレスの確認が必要です。
            <Link href="/account">ログイン・新規登録</Link>
          </p>
        </section>
        <section className="plan-card">
          <p className="eyebrow">今回のことを、詳しく</p>
          <h2>単発の詳細診断</h2>
          <p className="price">
            {yen(pricing.report)}
            <span> / 回（税込）</span>
          </p>
          <p>
            現在の相談について、13項目のレポートで整理します。月額契約は不要です。
          </p>
          <ul>
            <li>必要時だけ追加質問</li>
            <li>LINE文面3案</li>
            <li>7日・30日の行動プラン</li>
          </ul>
          <Link className="button secondary" href="/account">
            診断結果から詳しく見る
          </Link>
          <p className="fine">
            自動更新なし。既に購入したレポートはそのまま読めます。
          </p>
        </section>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <BillingTerms free={free} plus={plus} />
        <p>{testPaymentNotice}</p>
        <Link href="/legal/refund">返金・キャンセルの方針</Link>
      </section>
    </>
  );
}
