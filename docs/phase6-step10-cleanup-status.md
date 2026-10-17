# Phase 6 STEP 10 合成12UUID限定クリーンアップ・停止報告

2026-10-17。基準コミット `589735b2282dfd36b77f50faff5dc67eff88f747`、専用ブランチ `codex/yorisoi-phase6-redesign`。

**削除要求を1回行ったが、Supabase連携が `McpServerError: Invalid or expired requestState` を返したため停止した。再試行・別方式への切り替えはしていない。読み取り照合では対象12行がすべて不変で残っており、クリーンアップは未完了。** SQL実行結果・SQLSTATEは受領していないため、SQL自体の失敗やCOMMIT状況をツールエラーだけから断定しない。

秘密情報を含まない結果は [機械可読記録](phase6-step10-cleanup-results-20261017.json)。SQL本文・UUID・匿名ハッシュ・認証情報はGit管理外にのみ保管している。

## 対象と削除前確認

対象は `yorisoi-integration-test` / `ukdzggjfkcwjssjmnqim` のみ。管理APIで `ACTIVE_HEALTHY`、DBホスト `db.ukdzggjfkcwjssjmnqim.supabase.co` を確認した。既存Supabaseには接続していない。

| 項目 | 削除要求前 | エラー後の読み取り |
|---|---:|---:|
| consultation_subjects | 2 | 2 |
| consultation_threads | 2 | 2 |
| consultation_turns | 2 | 2 |
| diagnoses | 2 | 2 |
| diagnosis_answers | 2 | 2 |
| free_reports | 2 | 2 |
| Authユーザー／認証済み | 2 / 2 | 2 / 2 |
| profiles | 2 | 2、内容不変 |
| Authセッション | 3 | 3、内容不変 |
| Auth identities | 2 | 2、内容不変 |
| Auth refresh tokens | 13 | 13、内容不変 |
| rate_limits | 26 | 26、内容不変 |
| payments / subscriptions / billing_customers | 0 / 0 / 0 | 0 / 0 / 0 |
| ai_calls / consultation_ai_calls | 0 / 0 | 0 / 0 |
| migration | 17 | 17、履歴内容不変 |
| RLS有効アプリテーブル | 42 | 42 |
| 有効価格 | 0 | 0、全6価格不変 |
| 匿名AI | OFF | OFF |

元のINSERT manifest、Hosted実行用manifest、cleanup inventory、直前のHosted検証後スナップショット、実DBを照合した。12UUIDを再発行していない。診断2件の所有者はA/B各本人で、匿名ハッシュ・合成run識別子・全フィールド・親子関係が一致した。

参照FK15件は前回記録と一致。追加の相談AI・診断分析・選択質問・有料レポート・購入・アフィリエイト・trial関連行はなく、未知の子行をCASCADEで巻き込む状態ではなかった。対象6テーブルの非システムトリガーは0件。

## バックアップと削除SQL

Git管理外の `private-step10/cleanup-01`（0700）へ、削除前の対象12行全フィールド、元manifest、所有者・FK、状態・設定記録、47テーブルの件数と内容fingerprintをAES-256-GCMで保管した。Auth・public・trial_privateのACL、RLS、ポリシー、制約、関数権限、トリガーも別途暗号化した。復号して元の取得内容との完全一致を確認し、実行直前にも実DBがバックアップ時点から不変であることを照合した。既存バックアップや失敗記録は上書きしていない。

Authのパスワード・JWT・Refresh Tokenの実値を報告・ログへ出していない。Auth系は件数と内容fingerprintで不変性を確認しており、Authシステムスキーマを上書き復元する計画ではない。

cleanup SQLのSHA256：

`9b7bb4f5cd8864f1761f4be835bb824112d676b3592c66a83451a656440ea1a5`

既存cleanupは削除前件数を検査していたが、今回指定された「各DELETEの実際の影響行数が2でなければCOMMITしない」条件がなかった。そのため削除用DOブロック内で、6回それぞれ直後に `GET DIAGNOSTICS ... ROW_COUNT` を取得し、2以外なら例外でトランザクションを中断する処理を追加した。

元manifestから作成した完成cleanup SQLを0400で固定し、その同じバイト列をDocker検証と送信要求に使用した。対象・全依存テーブルをshare row exclusiveでロックしてから、UUID・所有者・親子関係・想定外の子行・未知FKを検査する。DELETEはUUID条件だけで、ターン→スレッド→相手→回答→無料レポート→診断の順。1トランザクション・6 DELETE・各2行、予定合計12行に限定している。アプリ本体と既存17migrationは変更していない。

## Docker・品質検証

通信なし・公開ポートなしの隔離PostgreSQLへ17migrationを適用し、元12UUIDの合成データとA/Bへ引き継ぎ済みの状態を再現した。実認証情報やセッションはコピーしていない。

固定INSERTと今回の完成cleanup SQLを対象とした **29項目が成功**。今回追加した検証は次の9項目。

- 固定cleanupと元manifest、引き継ぎ済み2診断の一致。
- 6テーブルそれぞれでDELETEを1行だけ抑止し、影響件数不一致でそれ以前の削除もすべてROLLBACKすること（6項目）。
- 未知のFKを追加した場合、子行0件でも削除前に拒否すること。
- 12行削除後のトランザクション内0件を確認し、明示ROLLBACKで全12行が戻ること。

既存の未知子行拒否、12UUID限定削除、対象外行・Auth・profiles保持も再確認した。明示ROLLBACK試験のみメモリ上で末尾COMMITを置換した検証入力を使い、保存済みcleanupファイルは変更していない。成功・影響行数不一致・未知FK・未知子行の試験は固定ファイルそのものを使用した。

- ローカル：lint・型チェック・Next.jsビルド成功。
- 自動テスト：**727件成功（既存726＋回帰1）**。外部33件は未実施・未検証で、失敗をskipに変更していない。
- Docker HTTP16・所有権18、Stripe初期化29：成功。Stripe外部接続・取引は0。
- GitHub CI：本変更コミットの実行結果を完了報告のリンクで確認する。実DBクリーンアップの成功とは区別する。

変更は `step10-fixtures.mjs` の削除件数検査、`step10-complete-sql-verify.py` の固定cleanup・異常系検証、回帰テスト、報告資料に限定した。

## 送信・停止・事後照合

送信前に新しい排他的予約 `delete.reserved.json` を作成した。Supabase SQLツールへの要求は **1回のみ**。ツールが要求状態エラーを返し、SQLの実行結果を返さなかった。予約を消したり再利用したりせず、STOPとエラー応答記録を追加した。

その後は読み取りだけを実施し、元12UUIDの全フィールドと所有者が変わらず残ることを確認した。public/trial_private全42テーブル、Auth4テーブル、migration履歴の計47テーブルで件数・fingerprintが削除前と一致。Authを含むACL/RLS・ポリシー・制約・関数権限・トリガーも一致した。観測された削除行数は0件で、想定外の副作用は検出されなかった。

Auth設定API、セッションrefresh・失効、メール、Stripe、OpenAI、Vercel、既存DB、mainは操作していない。rate_limitsや監査ログも削除していない。STEP10実行前のDB全体へ戻ったとは報告しない。

## 次に必要な承認

**所有権・引き継ぎ検証は前工程で成功済みだが、STEP10のクリーンアップを含む最終完了は未達。** 12行は現在も保存されている。DB復元や再投入は不要。

次回はSupabase連携の要求状態を確認・必要に応じて接続を更新した後、今回のSHA256の固定cleanup SQLについて、新たな1回の削除試行の承認を受ける。Authセッションを更新する必要はない。削除直前の全条件・バックアップ・UUID・FKを再確認し、新しい予約を前回エラー記録に紐づける。再生成・無条件再送・別方式での実行・権限拡張はしない。

今回は実DBの再試行をせず停止する。Stripe決済、OpenAI生成、Vercel公開、第2開発単位へ進まない。
