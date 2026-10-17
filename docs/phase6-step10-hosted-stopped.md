# Phase 6 STEP 10 実環境検証の停止記録

2026-10-17。対象は `ukdzggjfkcwjssjmnqim` のみ。基準コードは `e4b05dd1a3817a44c05ea0d9a8bd5a2650b20336`。**STEP 10は未完了**。

## 停止原因と現在の状態

合成12行の投入を1回試みたが、追加した事前条件ブロックの構文エラー（SQLSTATE `42601`、`do $ begin`）で停止した。ローカル生成器がJavaScriptの `String.replace` の置換文字列に `$$` を含め、ドル引用符を `$` に変換してしまった。これは実行器側の不具合であり、Supabaseの権限不足ではない。原本のfixture INSERTコンパイラや既存migrationは変更していない。

再実行・権限変更・repair・reset・削除は行っていない。読み取りで対象6テーブルが引き続き各0行であることを確認した。STEP10中継とAPIはSTOP状態にしている。投入予約記録は保持した。

| 確認対象 | 投入直前 | エラー後 |
|---|---:|---:|
| Authユーザー／メール認証済み | 2／2 | 2／2 |
| profiles | 2 | 2、内容fingerprint不変 |
| consultation_subjects / threads / turns | 各0 | 各0 |
| diagnoses / diagnosis_answers / free_reports | 各0 | 各0 |
| 購入・契約・課金顧客 | 各0 | 各0 |
| ai_calls / consultation_ai_calls | 各0 | 各0 |
| 有効価格 | 0 | 0、全6価格不変 |
| migration | 17 | 17 |
| RLS | public 35＋trial_private 7、全42有効 | publicのACL/RLS不変、DDL未実行 |
| 匿名AI | OFF | OFF |
| rate_limits | 既存22行 | 内容不変 |
| Stripe環境 | sandbox、新Account ID | 不変 |

実行直前にProject Ref、ACTIVE_HEALTHY、管理APIが返すDBホスト `db.ukdzggjfkcwjssjmnqim.supabase.co` を照合した。SQLは当該Refに固定したSupabaseコネクターで実行した。直接psql接続を行ったという意味ではない。

## 実施できたこと

- 追加承認に従い、既存の本人ブラウザーでA/Bのセッション更新操作を各1回実施。双方で同じUser ID、Refresh Token更新を確認。新規登録・ログアウト・メール送信なし。SDK内のHTTP呼び出し回数と画面操作回数は同一とみなさない。
- 新DBのAuth `/user` により、本人JWTのA/B UUIDとメール認証済み状態を確認。セッションはGit管理外でAES-256-GCM暗号化。
- 12UUIDの一意性、A/BのUUID、異なる匿名セッション、対象6テーブルの制約とFK、関連15FK、対象テーブルの非内部トリガー0件を確認。
- `claim_anonymous_diagnoses` はSECURITY INVOKER、postgres所有、空search_path、service_role限定EXECUTE。service_roleからauth.usersの直接SELECTは禁止を維持。
- 127.0.0.1:5208の専用API、5209の新DB限定中継。旧.env.localを読み込まない基準コミットの独立コピー。OSの外部直接通信拒否と、メール送信ルートの中継拒否を確認。Stripe/OpenAIキーなし。

## 未実施・未検証

合成データ投入成功、相談履歴の本人JWT RLS、実アプリ相談一覧・本文の所有権、匿名診断の正規claim、同時・重複claim、旧匿名Cookie拒否、所有者変更拒否の**実環境検証はすべて未実施**。本人認証確認を相談所有権成功と読み替えない。既存外部33件も未実施・未検証。

## 保全と復旧

Git管理外の `private-step10`（ディレクトリ0700）にmanifest、試行予約、実行SQL、暗号化した前後状態と復旧計画を保持。秘密値・Cookie・JWTは報告書へ記載しない。暗号鍵と暗号文はともに0600で同じMac上にあり、Macアカウント侵害への独立した鍵保護は提供しない。

事前状態の暗号化／復号一致を確認。既存の新DB専用暗号化バックアップにはローカル復元成功記録がある。今回の記録は比較・復旧判断用スナップショットであり、現在のAuthセッションまで含む完全なDBダンプではない。過去バックアップを現在のAuthへ上書き復元しない。

12UUIDは予定manifestとして存在するが、DBに作成された行は0。今回の失敗に対するデータ削除・復元は不要。Auth A/Bとprofiles、rate_limitsは削除しない。将来の投入後クリーンアップはmanifestの12UUIDと15FKを再照合し、想定外の子行があれば停止する設計。削除には別途承認が必要。

## ローカル品質確認

- 自動テスト707成功（既存673＋新規34）。外部33件は未実行として除外。
- lint・型チェック・専用コピーのNext.jsビルド成功。
- Dockerの既存HTTP16シナリオ、STEP10所有権18シナリオ成功。
- Stripe初期化のDocker29項目成功。Stripe外部通信なし。

これらは実環境投入の追加ラッパーSQLを検証していなかったため、今回の構文不具合を防げなかった。実環境14シナリオの実行器は未実行であり、成功済みとは扱わない。

## 次の承認事項

ローカル生成処理を関数形式の置換等へ修正し、**実際に送信する完成SQLそのもの**をDockerで実行して12行だけ生成されること、rollback／UUID限定cleanupを検証する。その後、対象DBと12UUIDが引き続き空であることを再確認し、修正後SQLのSHA256と検証結果を提示して、投入1回と後続検証の再開承認を得る。予約記録は削除・初期化せず、新しい試行は前回失敗との関連を記録する。

トークンが失効した場合の認証更新も再開時に確認する。既存DB、Stripe、OpenAI、メール、Vercel、Production、mainへの操作は実施していない。第2開発単位へ進まない。
