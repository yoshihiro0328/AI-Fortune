"use client";
import { useEffect, useState } from "react";
import { pricing } from "@/lib/pricing";
import Link from "next/link";
import SaveResultNote from "./save-result-note";
import { request, track, type Diagnosis } from "@/lib/client";
export default function Result({ id }: { id: string }) {
  const [d, setD] = useState<Diagnosis | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request<Diagnosis>("/api/diagnoses/" + id)
      .then((x) => {
        setD(x);
        if (x.free_report) track("free_report_viewed", id);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  async function checkout() {
    setBusy(true);
    setError("");
    track("paid_cta_clicked", id);
    try {
      const r = await request<{ url: string }>(
        "/api/diagnoses/" + id + "/checkout",
        {},
      );
      location.assign(r.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const r = d?.free_report;
  return (
    <main id="main" className="flow report">
      <div className="eyebrow">無料診断の結果</div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!d && !error && <p role="status">診断を読み込んでいます…</p>}
      {d?.status === "safety" ? (
        <section className="panel">
          <h1>あなたの安全を、いちばんに。</h1>
          <p>
            回答には、安全について気になる内容が含まれていました。通常の恋愛分析や有料レポートへの案内を止めています。
          </p>
          <p>
            危険が迫っている場合は、安全な場所へ移り、地域の緊急窓口へ連絡してください。日本では警察110、救急119です。
          </p>
          <p>
            信頼できる人や専門の相談窓口に、今の状況を伝えることも選択肢です。相手と一人で対決する必要はありません。
          </p>
          <a
            href="https://www.gender.go.jp/policy/no_violence/dv_navi/index.html"
            rel="noreferrer"
          >
            内閣府・DV相談ナビ
          </a>
          <br />
          <a href="https://www.mhlw.go.jp/mamorouyokokoro/" rel="noreferrer">
            厚生労働省・まもろうよ こころ
          </a>
        </section>
      ) : r ? (
        <>
          <h1>今のふたりを、整理すると。</h1>
          <section className="panel">
            <h2>現在の状況</h2>
            <p>{r.summary}</p>
          </section>
          <section className="panel">
            <h2>良い兆候</h2>
            {r.positive_signals.length ? (
              r.positive_signals.map((s) => (
                <div key={s.signal}>
                  <h3>{s.signal}</h3>
                  <p>{s.reason}</p>
                </div>
              ))
            ) : (
              <p>現時点で判断できる情報は十分ではありません。</p>
            )}
            <h2>気に留めたいこと</h2>
            {r.attention_signals.map((s) => (
              <div key={s.signal}>
                <h3>{s.signal}</h3>
                <p>{s.reason}</p>
              </div>
            ))}
          </section>
          <section className="panel">
            <div className="scores">
              {[
                ["relationship_stability", "関係の安定"],
                ["communication", "コミュニケーション"],
                ["improvement_potential", "関係を見直す余地"],
              ].map(([k, t]) => (
                <div className="score" key={k}>
                  <span>{t}</span>
                  <strong>
                    {r.scores[k as keyof typeof r.scores]}
                    <small> /100</small>
                  </strong>
                </div>
              ))}
            </div>
            <p className="fine">
              回答内容を整理するための目安です。実際の相手の気持ちや未来を保証するものではありません。
            </p>
            <h3>まだ分からないこと</h3>
            <ul>
              {r.uncertainties.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>まず、できること</h2>
            <p>{r.advice}</p>
          </section>
          <section className="notice">
            <h2>もう少し、具体的に整理したい方へ。</h2>
            <ul>
              {[
                "ふたりの関係や、相手の行動について考えられる理由",
                "連絡のタイミングと、送るLINE文面3案",
                "避けたい行動と、次に会うときのヒント",
                "7日・30日の行動プラン",
              ].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <div className="price">
              {pricing.report.toLocaleString("ja-JP")}
              <span>円（税込）</span>
            </div>
            <p className="fine">
              1回のお支払いで、自動更新はありません。現在はテスト決済のみで実請求は発生しません。
            </p>
            <SaveResultNote />
            {d.payment_status === "paid" ? (
              <Link className="button" href={"/report/" + id}>
                購入したレポートを見る
              </Link>
            ) : d.payment_status === "refunded" ? (
              <p>この診断の購入は返金済みです。</p>
            ) : (
              <button className="button" onClick={checkout} disabled={busy}>
                {busy ? "決済画面を準備中…" : "詳しい分析を見る"}
              </button>
            )}
            <p className="fine">
              購入は任意です。<Link href="/legal/refund">返金条件</Link>
              をご確認ください。
            </p>
          </section>
          <p>
            <Link href="/account">診断をアカウントに保存する</Link>
          </p>
        </>
      ) : (
        d && (
          <p>
            分析がまだ完了していません。
            <Link href="/diagnosis/partner-mind">診断を再開する</Link>
          </p>
        )
      )}
      <p>
        <Link
          href="/"
          onClick={() => localStorage.removeItem("yorisoi_diagnosis")}
        >
          トップへ戻る
        </Link>
      </p>
    </main>
  );
}
