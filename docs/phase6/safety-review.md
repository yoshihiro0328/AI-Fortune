# 第1開発単位：最終改善・安全性レビュー

2026-10-15 JST。基準コミット `a7fa27c`。第2開発単位への変更は含まない。匿名AIはOFF、実DB未適用、固定Preview未更新。

## 判断

**匿名AIをOFFにした保護付きPreviewの検証準備は完了。実AIをONにする承認条件は未完了。** 以下の新migrationをローカル/合成DBで検証したが、実環境には適用していない。

1. `20261014151638_trial_foundation.sql`（前回作成・変更なし）
2. `20261014160317_trial_safety_hardening.sql`（今回追加）

既存実DBは14migrationのまま。適用時には上記2件を順番に扱う。既存ローカル履歴と実履歴の時刻相違があるため、過去ファイルの一括push/repairは行わない。

## 表示・保持期間

TOPはリクエスト時に環境フラグとDBの有効状態・削除heartbeat・sandbox・既知料金・予算残を評価する。DB未適用/障害時も準備中へ倒す。OFF時は「登録なし・1回答無料」を表示せず、主ボタンを無料診断に変更。テーマ入口にも準備中を明示。相談画面でも未確認時/停止中に無料回答を利用できると表示しない。

利用者向けの「本文は最大24時間保存」を削除し、閲覧・引き継ぎの期限と完全削除を分けた。削除ボタンも「サービス上の本文・回答」と明記。以下は保証範囲の区別であり、24h完全消去保証ではない。

| 保存先 | 実装/確認できる範囲 | 残る条件 |
|---|---|---|
| 稼働中DB | 作成から最大24hで新たな取得/引き継ぎを拒否。期限削除でsession/turnを消去 | 毎分実行は未設定。障害/ロック/停止時の物理削除遅延あり。期限前に取得されたコピーは回収不能 |
| ブラウザー | HttpOnly短期Cookie。本文を永続ストレージに書かない。画面の期限タイマーで消去 | 利用者がコピーした内容、端末メモリ、OSの履歴までの消去保証はしない |
| バックアップ/PITR/WAL | アプリDBからのDELETEでは既存バックアップを消せない。暗号文と鍵がそろえば復元可能 | 実プロジェクトの保持設定と鍵管理の期限は未確認。匿名相談schemaはまだ存在しない |
| アプリ/基盤ログ | 新APIは本文・回答・Cookie・生IP・秘密鍵をログに出さず、未知例外も一般文言へ変換 | Vercel/PostgREST/DB監査/ログ転送先の全設定は未検証。入力を記録するmiddlewareやtraceを追加しない |
| OpenAI | responsesはstore=false、会話保存/背景実行/ツールなし | 不正利用監視は別。通常最大30日、法令/安全上の例外あり。実プロジェクトのZDR/MAM承認状態は未確認 |
| 非本文情報 | counterは1h/24h、challenge HMACは7日、費用台帳は35日。台帳に本文・生IP・user_idなし | cleanup実行が必要。35日を超えた未精算情報の破棄前に機能を停止 |
| 明示保存済み会員履歴 | 独立した相手/会話に所有者を設定し、匿名本文を消去 | 会員の保存方針へ移行。匿名の24h期限とは別 |

実DBの読み取り確認では `log_statement=ddl`、`log_min_duration_statement=-1`、`log_min_error_statement=error`、`log_parameter_max_length=-1`、`log_parameter_max_length_on_error=0`。この組み合わせだけで全ログに本文が残らないとは判断しない。事業者ログとエラー経路の合成データ検証が必要。

公式資料：[OpenAIのデータ保持](https://developers.openai.com/api/docs/guides/your-data)、[Supabaseバックアップ](https://supabase.com/docs/guides/platform/backups)。OpenAIのprompt cache等にも個別の保持条件がある。store=falseを全保存先の即時消去やZDRと同一視しない。

## 定期削除と監視の設計（未設定・要承認）

[Vercel Cron](https://vercel.com/docs/cron-jobs)はProduction対象なので、このPreview検証には使わない。[Supabase Cron](https://supabase.com/docs/guides/cron)でDB関数を直接毎分実行する方式を選ぶ。実DBにはpg_cron/pg_netとも未導入であり、拡張有効化・ジョブ設定は実DB変更の承認対象。

- 承認後のジョブ名：`yorisoi-trial-cleanup`、頻度：`* * * * *`、内容：`select public.trial_cleanup();`。対象Sandboxの確認済みDB内でのみ設定する。
- 1回の処理はトランザクションで、生成予約/精算/削除を同じ設定行ロックで順序付ける。statement timeout 20秒・lock timeout 5秒をジョブ接続に設定し、失敗時は全体rollback。削除とheartbeatの片方だけ成功させない。
- 通常の削除目標は期限後1分＋実行時間。これはSLOであり、全コピーが24h以内に消える保証ではない。
- 5分間成功がなければ運用警告。10分以上heartbeatが古い/未来時刻/未実行なら発行・生成とTOPの受付表示を停止。読み取りは各sessionの期限で独立して拒否。
- 10分以上の停止後にcleanupが回復するとDB enabled=falseに固定。勝手に受付を再開しない。復旧担当者が原因と未精算額、削除残件を確認して別途承認のうえ再開する。
- `GET /api/cron/trial/health` を専用Bearerで保護して追加。healthyなら200、heartbeat不良・5分以上期限超過のsession・料金期限切れは503。DBエラーも503。監視の読取ではheartbeatを更新しない。
- 独立した監視元から毎分healthを確認。連続2回失敗/10分heartbeat/削除残件は担当者へ通知する設計。DB内Cronと同時に止まる監視だけにしない。承認済みの運転予定とenabledを比較し、予期しないOFF、未精算件数の5分以上の増加、料金期限24h未満も通知対象にする。healthy=200だけでAI受付可能とは判断しない。通知先・監視基盤は未設定で、今回メッセージ送信や有料リソース作成は行わない。
- 監視保存は時刻・状態・件数・処理時間のみ7日。HTTPヘッダー/本文なし。Cron実行ログも当該ジョブの7日超だけ削除する管理ジョブを承認後に設定。DB全体や他ジョブのログは消さない。
- バックアップ復元時はアプリ/DBともOFFで起動し、まずcleanupで過期限データを消去。閲覧期限は作成時の値のまま、復元時刻から延長しない。

## AI予算の再検証

日3 USDは日本時間の匿名Sandboxだけ。従来の日次/30日枠に加えて、**直近24hの実績・予約と過去の未精算予約**も日次上限内に入れる。日付変更や長い不明状態で枠が復活する経路を防いだ。モデル料金は呼出しごとに保存し、期限切れ/未知なら停止。

入力3,000・出力1,200token、最高入力単価125 nanoUSD/token・出力500 nanoUSD/tokenを元に、2倍の **1,950,000 nanoUSD = 0.00195 USD** を予約。料金期限は2026-10-22 00:00 JSTのまま自動延長しない。公式料金を再確認したが、提供者側の実請求は今回発生させていない。価格の上限側で計算したsettled_nusdは保守的な推定費用であり、割引/キャッシュ内訳/税を含む請求額ではない。

- SDKに専用 `TRIAL_OPENAI_PROJECT_ID` を明示。未設定はOFF。専用keyと固定の `https://api.openai.com/v1` を使い、環境変数による別endpoint/組織への暗黙の切替を防ぐ。
- 公式token countと生成に同じmodel/input/schemaを渡すこと、usageをDBへ記録して単価と照合することを合成応答で検証。
- 実際に返るmodel名とservice_tierを照合。未知のモデル/snapshot、default以外、負数等の不正usageは出力せず、予約を保持しDBをOFFにする。実モデルがsnapshot名を返す場合は、その正確なIDと料金を検証・登録してから使う。
- cleanupや再試行によりuncertainになった旧callにも遅れて届いたusageを精算する。古いworkerは回答を上書きできない。期限削除後は台帳だけ精算し、本文を復活させない。
- usageが上限を超えたら全額を記録しOFF。既知課金をnot_sentでゼロに戻さない。冪等な精算は二重加算/再解放しない。

### 専用OpenAIプロジェクトの適用前手順

1. 匿名検証専用のSandbox用途プロジェクトを承認後に用意/選定。既存会員AIとkey/予算を共有しない。専用service accountの権限をResponses生成・token countに限定し、管理keyはアプリへ置かない。
2. project ID/keyの組み合わせを確認。許可モデル、RPM/TPMを必要最小限にし、他モデル・ツール・背景処理を使わない。
3. [OpenAIの強制支出上限](https://developers.openai.com/api/docs/guides/spend-limits)をprojectで有効にする。最初の限定試験は月3 USDなど小さい額、早期警告閾値を併用する。**単なる支出アラートは停止制御ではない。強制上限にも反映遅延があり、わずかな超過があり得る。月上限は日3 USDを代替しない。** 実アカウントの設定は未確認。
4. 最初はDB日次枠を3 USDより小さい試験枠（例0.10 USD）にする。認証済み担当者による合成相談のみ。自動再試行/複数地域/他用途利用なし。実AI試験は別途承認が必要。
5. 応答usage、token count、model、service tier、provider response ID、台帳のpricing versionを照合。提供者のUsage/Costsを同一project・同一UTC区間で取得し、JSTの集計区間へ合わせる。遅延反映を待って翌日も突合する。キャッシュread/write、reasoning、税/請求区分の差を区別する。
6. 台帳の保守的推定を超える実費、未知モデル、原因不明差額、価格期限24h未満を検知したらOFF。鍵失効・提供者上限停止も準備する。請求額をアプリだけで絶対保証できないため、有効化の判断は実測とリスク確認後。

[料金表](https://developers.openai.com/api/docs/pricing)、[使用量API](https://developers.openai.com/api/reference/resources/organization/subresources/usage)を参照。実プロジェクトの権限・保持・費用/トークン照合は未実施。合成試験を実課金検証成功とは扱わない。

## 追加コードレビュー

| 領域 | 対応・検証 |
|---|---|
| 所有権 | Cookie HMAC、本人getUser、email確認、明示consentと表示email照合。foreign turn ID/偽造Cookie/別ユーザー/削除済み相談を拒否 |
| 引き継ぎ整合性 | 相手/会話/ターン/context/匿名消去を同一transaction。異なる2アカウントの並列claimは1件だけ。delete/claim競合は完全な本人保存または保存なし |
| RLS/権限 | 新8表RLS、11RPC×2ブラウザーroleの22権限確認、全RPC SECURITY INVOKER・固定search_path。service_roleをクライアントに渡さない |
| CSRF | session発行/turn/claim/deleteすべてOrigin照合。欠落/異originはDB操作前に403。CronはCookie認証を使わず専用Bearerのみ |
| 同時実行 | 原子的予算ロックとリースtoken。日跨ぎ/古い未精算/旧worker/期限purgeと精算の競合を検証 |
| エラー | 例外からSQL/本文を返さずno-store。誤ったusage/model/tierは停止。本文をログ出力しない |
| 削除 | TTL・手動消去・失敗rollback・復旧後の自動再開禁止。未知費用の予約は本文削除後も保持 |
| React/UI | サーバーで判定してONの誤表示を防止。受信状態未確定時は確認中。秘密や費用行をclient propsへ渡さない。保持説明を共通componentにして文言ずれを防止 |

## 検証結果

lint・typecheck・全テスト・Next.js webpack build成功。**386成功、33外部接続skip、失敗0**。今回20件追加（UI6、DB6、API8）。Docker PostgreSQL 17.11/ネットワークなしで全16migration、既存合成購入の不変、dump復元、並列予算、RLS、delete/claim競合、purge/遅延精算競合が成功。

同一session12並列→1予約。日3 USD制約を高額な合成単価で試験し20並列→追加3予約、合計2.9289625 USD。既存無料月3・Plus月30は不変。

## migration適用前の確認事項

- 対象project `rnvrdrfdbapfafwjbygo`、payment_environment=sandbox、安定版HEAD、既存購入/購読照合、RLS、実14履歴を再取得。
- 新規バックアップと隔離復元を確認。原本を上書き/削除しない。
- 新規2SQLの順序と差分を明示して承認取得。過去migrationのrepairや既存履歴への書き換えなし。
- 初期enabled=false、TRIAL_ENABLED=falseを確認。DB適用だけで有効化しない。
- OFF状態の保護付きPreview更新は別承認。公開インデックスOFF、固定Preview更新先とコミットを固定。
- 実AIをONにする前にはpg_cron/監視/保持方針/専用project/実usageと料金照合/Turnstile/メールclaimの外部E2Eを完了し、別途有効化承認を得る。
- 即時停止はアプリとDBのOFF。既存ユーザーデータを過去backupで巻き戻さない。復旧はOFFの隔離環境で調査する。
