"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import SaveResultNote from "./save-result-note";
import { request, track } from "@/lib/client";
import type { PaidReport } from "@/lib/ai/schemas";
export default function Report({ id }: { id: string }) {
  const [report, setReport] = useState<PaidReport | null>(null),
    [status, setStatus] = useState("waiting"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [attempts, setAttempts] = useState(0);
  const tracked = useRef(false);
  const load = useCallback(async () => {
    try {
      const r = await request<{
        status: string;
        report: PaidReport | null;
        attempts: number;
      }>("/api/diagnoses/" + id + "/report");
      setStatus(r.status);
      setAttempts(r.attempts);
      setReport(r.report);
      setError("");
    } catch (e) {
      setReport(null);
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    let n = 0;
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      n++;
      if (n >= 60) {
        clearInterval(timer);
        return;
      }
      void load();
    }, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    if (report && !tracked.current) {
      track("paid_report_viewed", id);
      tracked.current = true;
    }
  }, [report, id]);
  async function retry() {
    setBusy(true);
    setStatus("generating");
    setError("");
    try {
      await request("/api/diagnoses/" + id + "/report", {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const list = (items: string[]) => (
    <ul>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
  return (
    <main id="main" className="flow report">
      <div className="eyebrow">YOUR NEXT STEP / 詳細レポート</div>
      <h1>
        あなたのペースで、
        <br />
        次の一歩を。
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!report ? (
        <section className="panel">
          <h2>
            {error
              ? "レポートを表示できませんでした"
              : status === "waiting"
                ? "お支払いの確認を待っています"
                : status === "failed"
                  ? "レポートを再生成できます"
                  : "レポートを準備しています"}
          </h2>
          <p>
            {error
              ? "診断したブラウザ、または保存したアカウントで開いているかをご確認ください。通信エラーの場合は、少し待ってから状況を確認できます。購入済みの場合、再購入は必要ありません。"
              : "決済通知の確認後にAIが分析します。数分かかる場合があります。再購入は必要ありません。"}
          </p>
          <button className="button secondary" onClick={load} disabled={busy}>
            状況を確認する
          </button>
          {["queued", "failed", "generating"].includes(status) &&
            attempts < 5 && (
              <p>
                <button className="button" onClick={retry} disabled={busy}>
                  {busy ? "生成中…" : "生成を再開する（追加料金なし）"}
                </button>
              </p>
            )}
          {attempts >= 5 && (
            <p>
              自動再試行の上限に達しました。運営への確認が必要です。決済の再実行はしないでください。
            </p>
          )}
        </section>
      ) : (
        <>
          <p className="fine">
            回答に基づく可能性の整理です。相手の気持ちや未来を保証するものではありません。
          </p>
          <SaveResultNote />
          {[
            [
              "1. 現在の関係分析",
              <p key="a">{report.relationship_analysis}</p>,
            ],
            [
              "2. 相手の行動パターン",
              <p key="b">{report.behavior_patterns}</p>,
            ],
            ["3. 距離が変化した理由の可能性", list(report.distance_reasons)],
            [
              "4. 良い兆候",
              list(
                report.positive_signals.map((s) => s.signal + "：" + s.reason),
              ),
            ],
            [
              "5. 注意すべき兆候",
              list(
                report.attention_signals.map((s) => s.signal + "：" + s.reason),
              ),
            ],
            ["6. あなたが見直せること", list(report.improvement_points)],
            ["7. やらない方がいいこと", list(report.avoid_actions)],
            ["8. 今、連絡するべきか", <p key="c">{report.contact_advice}</p>],
            [
              "9. 次に送るメッセージ案",
              <div key="d">
                {[
                  ["自然に", report.messages.natural],
                  ["少し積極的に", report.messages.proactive],
                  ["距離を保ちながら", report.messages.respectful_distance],
                ].map(([t, m]) => (
                  <div key={t}>
                    <h3>{t}</h3>
                    <p className="message">{m}</p>
                  </div>
                ))}
              </div>,
            ],
            ["10. 次に会ったときの対応", <p key="e">{report.next_meeting}</p>],
            [
              "11. 今後7日間",
              list(
                report.seven_day_plan.map((p) => p.period + "：" + p.action),
              ),
            ],
            [
              "12. 今後30日間",
              list(
                report.thirty_day_plan.map((p) => p.period + "：" + p.action),
              ),
            ],
            ["13. 総合アドバイス", <p key="f">{report.overall_advice}</p>],
          ].map(([title, content], i) => (
            <section className="panel" key={i}>
              <h2>{title}</h2>
              {content}
            </section>
          ))}
          <Link href="/account" className="button">
            アカウントに保存する
          </Link>
        </>
      )}
      <p>
        <Link href={"/result/" + id}>無料診断結果に戻る</Link>
      </p>
    </main>
  );
}
