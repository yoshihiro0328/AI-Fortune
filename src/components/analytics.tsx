"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/client";
import { metricRows, usd } from "@/lib/analytics";
type Data = {
  start: string;
  end: string;
  includeTest: boolean;
  settings: { free_limit: number; plus_limit: number };
  metrics: Record<string, number> & {
    models: {
      model: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
      estimated_usd: number | null;
      latency_ms: number;
      failed: number;
    }[];
    ai_by_plan: { plan: string; calls: number; estimated_usd: number | null }[];
    ai_by_user: {
      user_id: string;
      calls: number;
      estimated_usd: number | null;
      abuse_flag: boolean;
    }[];
    sources: { source: string; variant: string; visitors: number }[];
    cancel_reasons: { reason: string; count: number }[];
  };
};
export default function Analytics() {
  const [data, setData] = useState<Data | null>(null),
    [test, setTest] = useState(true),
    [days, setDays] = useState(30),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [free, setFree] = useState(3),
    [plus, setPlus] = useState(30);
  const load = useCallback(async () => {
    const end = new Date(),
      start = new Date(end.getTime() - days * 86400000);
    const d = await request<Data>(
      `/api/admin/analytics?test=${test}&start=${start.toISOString()}&end=${end.toISOString()}`,
    );
    setData(d);
    setFree(d.settings.free_limit);
    setPlus(d.settings.plus_limit);
  }, [days, test]);
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await request("/api/admin/analytics", {
        free_limit: free,
        plus_limit: plus,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="wrap section">
      <p className="eyebrow">運営者専用</p>
      <h1>利用・収益の確認</h1>
      <Link href="/admin/contact">問い合わせ管理</Link>
      <div className="actions">
        <label>
          集計期間
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>直近7日</option>
            <option value={30}>直近30日</option>
            <option value={90}>直近90日</option>
          </select>
        </label>
        <label className="choice">
          <input
            type="checkbox"
            checked={test}
            onChange={(e) => setTest(e.target.checked)}
          />
          利用集計にテストデータを含める
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data ? (
        <>
          <p>
            {new Date(data.start).toLocaleString("ja-JP")}〜
            {new Date(data.end).toLocaleString("ja-JP")}（終了時刻未満）
          </p>
          <p className="notice">
            現在はPreview・Sandboxのみです。テスト決済は実売上に含めません。少数のテスト利用から集客・収益の成果は判断できません。7日・30日の観察期間を満たさない再訪指標は計測中です。
          </p>
          <div className="analytics-table">
            <table>
              <thead>
                <tr>
                  <th>指標</th>
                  <th>値</th>
                  <th>定義・分母</th>
                </tr>
              </thead>
              <tbody>
                {metricRows(data.metrics).map(([label, value, formula]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td>{value}</td>
                    <td>{formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>AI原価（USD・実トークンからの推計）</h2>
          <p>
            Standard単価とキャッシュ使用量から算出。請求額の確定値ではありません。過去の単価・トークン・失敗時使用量が欠ける集計は「未計測」と表示します。
          </p>
          <div className="analytics-table">
            <table>
              <thead>
                <tr>
                  <th>モデル</th>
                  <th>呼出</th>
                  <th>入力 / 出力</th>
                  <th>推計原価</th>
                  <th>平均応答時間</th>
                  <th>失敗</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.models.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td>{m.calls}</td>
                    <td>
                      {m.input_tokens} / {m.output_tokens}
                    </td>
                    <td>{usd(m.estimated_usd)}</td>
                    <td>{(m.latency_ms / 1000).toFixed(1)}秒</td>
                    <td>{m.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>無料・Plus・診断別の原価</h3>
          <ul>
            {data.metrics.ai_by_plan.map((p) => (
              <li key={p.plan}>
                {(
                  {
                    free: "無料相談",
                    plus: "Plus相談",
                    diagnosis: "無料診断",
                    report: "単発レポート",
                  } as Record<string, string>
                )[p.plan] ?? p.plan}
                ：{usd(p.estimated_usd)} / {p.calls}呼出
              </li>
            ))}
          </ul>
          <p>
            相談1往復あたり：
            {data.metrics.exchanges > 0 &&
            data.metrics.ai_by_plan
              .filter((p) => ["free", "plus"].includes(p.plan))
              .every((p) => p.estimated_usd !== null)
              ? usd(
                  data.metrics.ai_by_plan
                    .filter((p) => ["free", "plus"].includes(p.plan))
                    .reduce((n, p) => n + (p.estimated_usd ?? 0), 0) /
                    data.metrics.exchanges,
                )
              : "未計測"}
            （再生成・安全判定を含む相談用AI原価 / 成功した相談往復）
          </p>
          <details>
            <summary>ユーザー別の期間内AI原価・利用アラート</summary>
            <p>
              100呼出を超えるアカウントを確認対象にします。異常利用と断定するものではありません。
            </p>
            <ul>
              {data.metrics.ai_by_user.map((u) => (
                <li key={u.user_id}>
                  {u.user_id}：{u.calls}呼出 / {usd(u.estimated_usd)}{" "}
                  {u.abuse_flag ? "・利用状況を確認" : ""}
                </li>
              ))}
            </ul>
          </details>
          <h2>流入元</h2>
          <ul>
            {data.metrics.sources.map((s, i) => (
              <li key={i}>
                {s.source} / {s.variant ?? "従来画面"}：{s.visitors}識別子
              </li>
            ))}
          </ul>
          <h2>解約理由</h2>
          <ul>
            {data.metrics.cancel_reasons.map((r) => (
              <li key={r.reason}>
                {r.reason}：{r.count}件
              </li>
            ))}
          </ul>
          <section className="panel">
            <h2>相談回数の上限</h2>
            <p>
              変更は現在の利用期間にも反映されます。価格や既存契約の請求額は変更しません。利用者への案内を確認したうえで変更してください。
            </p>
            <label htmlFor="free-limit">無料の上限</label>
            <input
              id="free-limit"
              type="number"
              min={0}
              max={100}
              value={free}
              onChange={(e) => setFree(Number(e.target.value))}
            />
            <label htmlFor="plus-limit">Plusの上限</label>
            <input
              id="plus-limit"
              type="number"
              min={1}
              max={1000}
              value={plus}
              onChange={(e) => setPlus(Number(e.target.value))}
            />
            <button className="button" disabled={busy} onClick={save}>
              利用上限を保存
            </button>
          </section>
        </>
      ) : (
        !error && <p role="status">集計しています…</p>
      )}
    </main>
  );
}
