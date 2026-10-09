export function ratio(n: number, d: number) {
  return d > 0
    ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})`
    : "計測中（分母なし）";
}
export function average(n: number, d: number, unit = "") {
  return d > 0 ? `${(n / d).toFixed(2)}${unit}` : "計測中";
}
export function usd(v: unknown) {
  return typeof v === "number" ? `約$${v.toFixed(5)}（推計）` : "未計測";
}
export function money(v: unknown) {
  return typeof v === "number" ? `${v.toLocaleString("ja-JP")}円` : "未計測";
}
export function metricRows(m: Record<string, number>) {
  return [
    [
      "訪問者数",
      m.visitors,
      "期間内のpage_viewのアカウント／匿名ブラウザ識別子の重複を除いた数",
    ],
    ["無料診断開始数", m.starts, "期間内に作成された診断"],
    [
      "無料診断完了数",
      m.completions,
      "同じ開始対象のうち期間末までに無料結果を作成",
    ],
    ["診断完了率", ratio(m.completions, m.starts), "完了数 / 開始数"],
    [
      "会員登録数",
      m.registered,
      "期間内に作成されたメール認証済みアカウント。現在のPreview登録は全件テスト",
    ],
    [
      "再相談利用者数",
      m.consulting_users,
      "期間内に継続相談を正常に利用したアカウント数",
    ],
    [
      "7日以内再訪率",
      ratio(m.return7_numerator, m.return7_denominator),
      "期間内初訪問のうち7日観察できた識別子が対象。24時間後〜7日以内の再訪",
    ],
    [
      "30日以内再訪率",
      ratio(m.return30_numerator, m.return30_denominator),
      "期間内初訪問のうち30日観察できた識別子が対象。24時間後〜30日以内の再訪",
    ],
    [
      "1人あたり相談回数",
      average(m.exchanges, m.consulting_users, "回"),
      "正常な相談往復 / 継続相談利用者。再生成・安全案内を除く",
    ],
    [
      "無料→Plus転換率",
      ratio(m.plus_users, m.registered),
      "期間内Plus加入者 / 期間内登録者（集計期間によるフロー比。コホート転換率ではありません）",
    ],
    [
      "単発診断購入率",
      ratio(m.report_buyers, m.completions),
      "期間内購入診断数 / 期間内開始・完了診断数（フロー比）",
    ],
    ["Plus新規契約数", m.plus_new, "期間内に作成され支払い確認済みの契約数"],
    [
      "Plus有効契約数",
      m.plus_active,
      "現在の支払い済み有効契約数（期間合計ではありません）",
    ],
    [
      "Plus解約数",
      m.plus_canceled,
      "期間内に契約終了を確認した件数。解約予約は含まない",
    ],
    [
      "月額会員継続率",
      ratio(m.renewal_paid, m.renewal_due),
      "期間内に更新期日を迎えた契約のうち次の支払いを期間末までに確認できた割合",
    ],
    [
      "MRR（実売上）",
      money(m.mrr),
      "現在の有効な本番月額契約の月額合計。単発・Sandboxを除外",
    ],
    [
      "単発売上（実売上）",
      money(m.report_sales),
      "期間内の本番単発決済。返金済みを除外",
    ],
    [
      "売上合計（実売上）",
      money(m.monthly_revenue),
      "期間内本番単発＋月額入金。Sandbox除外",
    ],
    [
      "ARPU",
      average(m.monthly_revenue, m.active_users, "円"),
      "実売上 / 期間内アクティブ識別子。テストを含む表示中の値は参考外",
    ],
    [
      "ARPPU",
      average(m.monthly_revenue, m.paying_users, "円"),
      "実売上 / 本番入金のあった会員。匿名購入は会員分母に含めない",
    ],
    [
      "Checkout開始率",
      ratio(m.checkout_starts, m.cta_views),
      "Checkout開始イベント / 無料結果・プラン閲覧イベント。再訪含むフロー比",
    ],
    [
      "決済完了率",
      ratio(m.checkouts_completed, m.checkout_starts),
      "単発購入＋初回月額支払い / Checkout開始イベント（フロー比）",
    ],
    [
      "Sandbox単発テスト額",
      money(m.test_report_volume),
      "実売上には含めません",
    ],
    ["Sandbox月額テスト額", money(m.test_plus_volume), "実売上には含めません"],
    ["OpenAI呼出回数", m.ai_calls, "期間内の実行ログ。失敗も含む"],
    ["AI失敗回数", m.ai_failed, "回答として確定できなかった呼び出し"],
    ["Stripe手数料", money(m.stripe_fee), "未取得。0円と見なしません"],
    [
      "返金額（実決済）",
      money(m.refunds),
      "本番返金。部分返金など未取得があれば未計測",
    ],
    [
      "概算粗利益",
      money(m.gross_profit),
      "実売上−返金−Stripe手数料−円換算AI原価。費用または換算レートが未取得なら算出しません",
    ],
    [
      "1ユーザーあたり概算粗利益",
      "未計測",
      "概算粗利益 / アクティブ会員。費用の未取得があるため未算出",
    ],
  ];
}
