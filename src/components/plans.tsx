"use client";
import { usePaymentDisplay } from "./payment-display-provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/client";
import BillingTerms from "./billing-terms";
import { pricing, yen } from "@/lib/pricing";
export default function Plans({ free, plus }: { free: number; plus: number }) {
  const payment = usePaymentDisplay();
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [member, setMember] = useState(false);
  useEffect(() => {
    let alive = true;
    void request<{ user: { confirmed: boolean } | null }>("/api/auth")
      .then((r) => {
        if (alive) setMember(!!r.user?.confirmed);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
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
            相談回数：<strong>月{free}往復</strong>
            まで。登録・ログイン後に利用できます。
          </p>
          <ul>
            <li>返信作成：利用できます</li>
            <li>履歴の引き継ぎ：利用できます</li>
            <li>診断・相談履歴の閲覧：利用できます</li>
            <li>詳細レポート：別売{yen(pricing.report)}・単発購入</li>
          </ul>
          <div className="section-actions">
            <Link
              className="button"
              href={member ? "/consult" : "/account?next=%2Fconsult"}
            >
              {member ? "無料プランで相談する" : "登録・ログインして無料相談"}
            </Link>
            <Link className="button secondary" href="/chat">
              登録なしのお試しについて
            </Link>
            <Link className="button secondary" href="/diagnosis/partner-mind">
              質問に答えて整理する（無料診断）
            </Link>
          </div>
        </section>
        <section className="plan-card">
          <p className="eyebrow">出来事があったときに、また</p>
          <h2>よりそい Plus</h2>
          <p className="price">
            {yen(pricing.plus)}
            <span> / 月（税込）</span>
          </p>
          <p>
            相談回数：<strong>月{plus}往復</strong>
            まで。無料プランとの主な違いは相談できる回数です。
          </p>
          <ul>
            <li>返信作成：利用できます</li>
            <li>履歴の引き継ぎ：利用できます</li>
            <li>診断・相談履歴の閲覧：利用できます</li>
            <li>詳細レポート：別売{yen(pricing.report)}・単発購入</li>
          </ul>
          <p className="fine">
            詳細レポートは含まれません。別途{yen(pricing.report)}（税込）です。
          </p>
          <p className="fine">
            解約手続き後も支払い済みの期間は利用でき、次回からの自動更新を停止します。
          </p>
          <label className="choice">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            月額{yen(pricing.plus)}
            （税込）で、解約するまで毎月自動更新します。マイページから次回の更新を停止できることを確認しました。
            {payment.notice}
          </label>
          <button
            className="button"
            disabled={busy || !consent}
            onClick={checkout}
          >
            {busy ? "手続き画面を開いています…" : payment.checkoutLabel}
          </button>
          <p className="fine">
            登録後、メールアドレスの確認が必要です。
            <Link href="/account">ログイン・新規登録</Link>
          </p>
        </section>
        <section className="plan-card">
          <p className="eyebrow">今回のことを、詳しく</p>
          <h2>詳細レポート</h2>
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
          <p>
            <Link className="button secondary" href="/report-sample">
              詳細レポートの見本を見る
            </Link>
          </p>
          <Link className="button secondary" href="/account#diagnosis-history">
            マイページで診断履歴を見る
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
        <BillingTerms free={free} plus={plus} compact />
        <p>{payment.notice}</p>
        <Link className="button secondary" href="/legal/refund">
          返金・キャンセルの方針
        </Link>
      </section>
    </>
  );
}
