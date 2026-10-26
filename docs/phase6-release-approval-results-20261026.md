# 限定SQL適用・解約イベント照合の結果（2026-10-26）

今回の外部書込みは、承認された関数更新のmigration 1件だけ。追加購入、再契約、新規キー、イベント再送、既存状態の修正、マージ、デプロイは行っていない。

## SQLの適用と照合

- 対象：`ukdzggjfkcwjssjmnqim` / yorisoi-integration-test / ACTIVE_HEALTHY。DBのpayment_environmentもSandbox `acct_1UQlQdI73kTcvXz8` と一致。
- ソース：`supabase/migrations/20261026034025_subscription_terminal_state.sql`。SHA256は `595e1ec07a064dd069818a45f235b57bd08e85345b36163fd9db5f3037ee16ef`。
- レビュー・CI成功のコミット `52630ae0a5c4616a3a9809abbbd9833909bef8cc` のファイルと作業コピーが完全一致。事前CI：`40266153371`。
- 適用前の関数本体は旧migrationと一致。必要なテーブル列・制約、ended_at、RPC引数、17件の既存migrationを確認。
- 適用前の関数定義・owner・ACL・設定・実効権限とスキーマ／データ照合値を、プロジェクト直下の `release-approval-20261026/before.json` に保存。秘密値や行本文は含めない。
- Supabase apply_migrationを**1回**実行して成功。MCPが付番した履歴は **`20261026040808 / subscription_terminal_state`**。ソースファイルの時刻と別であることを記録し、履歴を手動変更しない。
- 適用後の関数本体は承認SQLと一致。owner=postgres、SECURITY INVOKER、空search_path、postgres/service_roleのみEXECUTEを維持。anon/authenticatedのEXECUTEはfalse。
- migrationは旧17件を保持して18件へ。スキーマ比較、7表の件数・全行ダイジェストが適用前後で一致。payments 1、stripe_events 4、subscriptions 2、price_versions 6、service_settings 1、billing_customers 1、subscription_invoices 2。
- `release-approval-20261026/after.json` に照合結果を保存。[非秘密の結果JSON](phase6-limited-sql-application-20261026.json)。関数実行による既存契約の試験更新は行っていない。

問題時は新規販売・対象処理を止め、保存した関数とACLから復旧案を作る。既存データやmigration履歴を巻き戻さない。現在は復旧不要。ローカルの旧fixture 17件は歴史比較用として保持し、全18migrationの検証とは区別する。

## 実解約通知の証拠

対象契約 `sub_1UTg3hI73kTcvXz8bbbuwStW` に対して、Stripeの `customer.subscription.deleted` イベント **`evt_1UTg6KI73kTcvXz8GlQf7Pbk`** が存在した。created/ended_at=`1792752812`、livemode=false、status=canceled。型＋発生秒＋最大3件に限定し、has_more=false。

`pending_webhooks=0` は、今回のアプリが受信・処理した証明にはならない。接続済みStripe MCPの配送試行履歴検索では該当APIを見つけられず、別経路や新しい資格情報で調査を広げていない。DBの `stripe_events` を同一イベントIDで読み取ると **0件**。配送されなかったと断定せず、**アプリ宛配送の結果、署名検証済み受信、同一イベントのDB commit、他の更新を挟まないPlus→Freeの前後証拠が不足**と確定する。

従前の「現在Free」はGET billingの照合・直接同期による結果として保持。過去の遷移を今回の成功へ変更しない。解約イベントの原文・Customer個人情報・Portal URLは記録に含めず、許可した識別子と状態のみ `release-approval-20261026/cancellation-event.json` に保存した。

旧Portal URLは今回取得・再掲・再利用していない。実際の期限切れ／失効は未確認のまま。キー失効や契約解約でURLも失効したとは扱わない。

## 資格情報なしの追加準備

既存の署名付きハンドラー→同期→実SQL/RPC→権限API→描画の隔離試験へ、更新成功、失敗した更新、期間末解約の3ケースを追加。対象27件は成功。既存の重複・逆順・競合・RLS・単発購入回帰を再利用し、実環境の証拠と混ぜない。

`remaining-plan.mjs` は次回の上限表、送信前の操作数予約、結果不明時の停止、非秘密の解約証拠判定、AI費用計算を提供する。14件の資格情報なし試験で、上限超過、同じ操作の再送、証拠不足・直接同期混入、機密フィールドの受入を拒否することを確認。**この計画用モジュール自体は外部実行アダプターではなく、現行の旧C試験を自動的に新しい範囲へ広げない。** 次の承認後は固定した計画を専用実行経路へ接続してから、資格情報を受け取る。

AI専用provider wrapperは、実SDKを合成HTTPへ向けて入力計数と構造化応答のparseまで検証。過大入力は生成前に拒否し、結果不明・不正usage・想定外tierでは費用予約を残して停止する。アプリ本番のモデルや費用設定は変更しない。

自己レビュー：SQL適用とデータ更新の分離、旧証拠の保持、過去Freeと通知遷移の分離、支払い済み額0の失敗請求、DB時刻とClock時刻の差、未知結果の再送禁止、費用の全試行予約を確認。独立した第三者レビューとは区別する。最終CI結果は今回コミットのCI記録を参照する。

具体的な次回承認案は [残る外部試験とAI評価の計画](phase6-remaining-external-plan-20261026.md)。今回のSQL適用を再承認事項へ戻さない。
