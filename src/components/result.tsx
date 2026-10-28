"use client";
import { usePaymentDisplay } from "./payment-display-provider";
import { useEffect, useState } from "react";
import { pricing } from "@/lib/pricing";
import Link from "next/link";
import ContinueDiagnosis from "./continue-diagnosis";
import SaveResultNote from "./save-result-note";
import { request, track, type Diagnosis } from "@/lib/client";
export default function Result({ id }: { id: string }) {
  const payment = usePaymentDisplay();
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
    <main id="main" className="flow report result-page">
      <div className="eyebrow">無料診断の結果</div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!d && error && (
        <section className="panel">
          <h1>この診断は開けませんでした</h1>
          <p>
            診断したときのブラウザ、または保存したアカウントで開いているかをご確認ください。新しく診断を始めることもできます。
          </p>
          <div className="actions">
            <Link className="button" href="/diagnosis/partner-mind?new=1">
              新しく診断を始める
            </Link>
            <Link className="button secondary" href="/account">
              ログインして確認する
            </Link>
          </div>
        </section>
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
            <h2 id="result-evidence">良い兆候</h2>
            <p className="fine">
              根拠になった発言・出来事と、その解釈を合わせて確認します。
            </p>
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
          </section>
          <section className="panel result-attention">
            <h2>気に留めたいこと</h2>
            {!r.attention_signals.length && <p>この項目の記載はありません。</p>}
            {r.attention_signals.map((s) => (
              <div key={s.signal}>
                <h3>{s.signal}</h3>
                <p>{s.reason}</p>
              </div>
            ))}
          </section>
          <section className="panel result-unknown">
            <h2>まだ分からないこと</h2>
            <p className="fine">
              情報がないことだけで、悪い兆候とは判断しません。
            </p>
            <ul>
              {r.uncertainties.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {!r.uncertainties.length && <p>この項目の記載はありません。</p>}
          </section>
          <section className="result-action">
            <h2>まず、できること</h2>
            <p>{r.advice}</p>
          </section>
          <section className="result-indicators">
            <h2>回答から整理した3つの指標</h2>
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
              各指標は100点満点（0〜100）の整理用の目安です。入力された出来事をもとにAIが評価したもので、相手の好意や恋愛が成功する確率、客観的な精度を示すものではありません。
            </p>
            <p className="fine">
              <a href="#result-evidence">良い兆候・気に留めたいこと</a>
              の理由と、まだ分からないことを合わせてお読みください。入力にない事情は判断できません。
            </p>
          </section>
          <section className="notice">
            {d.payment_status === "paid" ? (
              <>
                <h2>購入済みの詳細レポート</h2>
                <p>
                  この診断の詳しい整理と行動プランを確認できます。再購入は必要ありません。
                </p>
                <Link className="button" href={"/report/" + id}>
                  購入したレポートを見る
                </Link>
                <SaveResultNote
                  key={id}
                  state={d.saveState}
                  onSaved={() =>
                    setD((current) =>
                      current ? { ...current, saveState: "saved" } : current,
                    )
                  }
                  returnTo={"/result/" + id}
                />
              </>
            ) : d.payment_status === "refunded" ? (
              <>
                <h2>詳細レポート</h2>
                <p>この診断の購入は返金済みです。</p>
              </>
            ) : (
              <>
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
                  1回のお支払いで、自動更新はありません。{payment.notice}
                </p>
                <SaveResultNote
                  key={id}
                  state={d.saveState}
                  onSaved={() =>
                    setD((current) =>
                      current ? { ...current, saveState: "saved" } : current,
                    )
                  }
                  returnTo={"/result/" + id}
                />
                <button className="button" onClick={checkout} disabled={busy}>
                  {busy ? "決済画面を準備中…" : "詳細レポートの購入へ進む"}
                </button>
                <p className="fine">
                  購入は任意です。<Link href="/legal/refund">返金条件</Link>
                  をご確認ください。
                </p>
              </>
            )}
          </section>
          <div className="section-actions">
            <ContinueDiagnosis id={id} state={d.saveState} />
          </div>
        </>
      ) : (
        d && (
          <p>
            分析がまだ完了していません。
            <Link className="button secondary" href="/diagnosis/partner-mind">
              診断を再開する
            </Link>
          </p>
        )
      )}
      <p className="section-actions">
        <Link
          className="button secondary"
          href="/"
          onClick={() => localStorage.removeItem("yorisoi_diagnosis")}
        >
          トップへ戻る
        </Link>
      </p>
    </main>
  );
}
