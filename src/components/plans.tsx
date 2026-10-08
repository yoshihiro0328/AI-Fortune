"use client";
import { useState } from "react";
import Link from "next/link";
import { request } from "@/lib/client";
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
            <li>初回の動的診断・無料結果</li>
            <li>相談相手ごとの履歴と記憶</li>
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
            、解約まで毎月自動更新すること、マイページから期間末で解約できることを確認しました（現在はテスト決済）。
          </label>
          <button
            className="button"
            disabled={busy || !consent}
            onClick={checkout}
          >
            {busy ? "手続き画面を開いています…" : "Plusのテスト契約へ"}
          </button>
          <p className="fine">
            メール認証済みアカウントが必要です。
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
        <h2>利用回数と契約について</h2>
        <p>
          正常に回答が届いた1往復を1回と数えます。初回診断は別枠です。失敗・同じ送信の再試行・回答の再生成は追加消費しません。再生成は1回答につき3回までです。
        </p>
        <p>
          無料は日本時間の毎月1日に更新。Plusは契約の請求期間ごとに更新し、残り回数は繰り越しません。期間中の利用回数はマイページで確認できます。
        </p>
        <p>
          Plusは申込時と毎月の更新日に決済します。解約はマイページまたは支払い管理から手続きでき、支払い済みの期間末まで利用できます。次の期間の支払いが確認できない場合、支払い済み期間の終了後は無料プランになります。上限後・契約終了後も履歴は読めます。
        </p>
        <p>安全に関わる案内は、プランや残り回数にかかわらず利用できます。</p>
        <p>現在はテスト決済のみで実請求は発生しません。</p>
        <Link href="/legal/refund">返金・キャンセルの方針</Link>
      </section>
    </>
  );
}
