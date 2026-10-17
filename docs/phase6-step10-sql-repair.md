# Phase 6 STEP 10 完成SQL修正・隔離検証

2026-10-17 / 基準コミット `6c141aace95cdf76ce0d76a7c3d9c4354bddbfbe`。今回の実環境操作は新Supabase `ukdzggjfkcwjssjmnqim` の読み取りのみ。**合成データ再投入・実claimは未実施、再承認待ち**。

## 原因と修正

前回、ローカルで追加した事前確認ブロックを `String.replace('begin;', preamble)` の置換文字列として渡したため、JavaScriptの仕様で `$$` が `$` に展開され、`DO` のドル引用符が壊れた。SQLSTATE 42601で停止し、12行は作成されなかった。

生成処理を `scripts/phase6/step10-sql-artifact.mjs` に移し、`replace(/^begin;/, () => preamble)` の関数形式に修正。保存済み失敗SQLと比較し、修正版の違いがドル引用符2箇所だけであることをローカルで確認した。既存17migration、アプリSQL仕様、fixture INSERT本文、事前条件は変更していない。

他の生成処理も監査した。JavaScriptの別SQL置換は固定の失敗注入文字列でドル記号を含まない。HTMLエスケープとrisk処理は関数形式、認証コードは文字列除去のみ。Pythonの `str.replace` はJavaScriptの置換記号展開を行わない。追加の同種不具合は見つからなかった。

## 固定した完成SQL

SHA256:

`faf7ec38fd9fa3a38edeac2bd4c94f5a609fca25520da84a82911810fb27000e`

- Git管理外の `private-step10/repair-01/complete.sql` に保存。親ディレクトリ0700、SQL・manifest・試行情報0400。
- 元の12UUID、A/BユーザーUUID、匿名セッションハッシュを維持。元manifestとの一致を確認。SQL本文・UUID・ハッシュはGitHubやこの報告に載せない。
- 旧 `insert.sql`、`insert.reserved.json`、元manifest、暗号化前後状態・復旧計画・STOPを保全し、変更前後のSHA256一致を確認。
- 新しい試行情報は前回予約記録のSHA256へ紐づけ、`prepared-not-authorized` のまま保持。送信済み・成功済みへ変更していない。
- `saveArtifact` は既存ディレクトリを上書きしない。将来送信時は `verifiedBytes` で保存済みファイルを読み、報告のSHA256・manifest・Docker検証結果と一致したバイト列だけを使用する。再生成は行わない。
- この読取関数自体にはネットワーク送信・承認解除機能がない。SQL変更時は新しい証跡とDocker再検証、別途再承認が必要。

## Docker検証20項目

結果は [秘密値を含まない検証記録](phase6-step10-complete-sql-results.json) に保存。

新しいPostgreSQLコンテナーを `--network none`、公開ポートなし、Unix socketのみで起動。17migrationを順番に適用し、全チェックサム一致を確認した。postgresを非superuserへ戻し、service_roleのAuth直接SELECT禁止を維持。既存Stripe初期化も**Docker内の設定再現のみ**で実行した。

テストユーザーは保存済みのA/B UUIDを用いた最小Auth行で、メール・パスワード・JWT・実Authセッションはコピーしていない。profilesは表示名NULLの2件について識別子・時刻を再現し、実際の完成SQLが要求する事前fingerprintを一致させた。

| 試験 | 結果 |
|---|---|
| 完成SQLの構文・実行 | 保存済みバイト列をそのままPostgreSQLが受理 |
| INSERT | 6テーブル各2行、計12行。UUID集合・匿名ハッシュ一致 |
| 既存状態 | Auth・profiles・ACL/RLS・価格・無料/Plus枠不変、決済/契約0、匿名AI OFF |
| 二重実行 | 同じSQLの2回目を事前条件で拒否、12行維持 |
| 同時実行 | 2接続中1件だけ成功、他方拒否、合計12行 |
| 事前条件不一致 | 未認証、profiles変化、匿名AI ON、migration不足、RLS OFF、環境不一致、既存行をそれぞれ拒否 |
| 明示ROLLBACK | 別DBで12行がトランザクション内に存在することを確認し、ROLLBACK後0行 |
| 途中失敗 | 別DBで12番目のINSERTへ障害注入。完成SQLそのものを実行し、先行11行も巻き戻り0行 |
| 想定外の子行 | cleanupを拒否、全行を維持 |
| UUID限定cleanup | 対象12行だけ削除、無関係な1行・A/B・profilesを維持 |
| ファイル一致 | 全試験後も完成SQLのバイト列とSHA256不変 |

明示ROLLBACK試験だけは固定ファイルを変更せず、メモリ上で末尾COMMITを検証用ROLLBACKへ差し替えた派生入力を使用する。成功、二重・同時実行、事前条件不一致、途中失敗試験はすべて保存済み完成SQLそのものを送っている。ROLLBACK用派生入力を将来の投入SQLとして扱わない。

隔離テスト作成中に、既存Stripe初期化が要求するDB名と、不一致試験の準備順序で失敗した。DB名を既存指定へ合わせ、環境不一致の準備をAuth行投入前の空状態で行ってから最小行を復元する方式に修正した。保護トリガーを無効化していない。失敗をskipせず、最終的に全20項目を再実行して成功。完成SQLはこれらの実行器修正で変更していない。

## 品質確認

- 自動テスト **726件成功 = 既存707＋回帰19**。外部33件は未実施・未検証のまま。
- 回帰19件は旧不具合の再現、DO/ENDドル引用符保持、INSERT本文一致、manifest不変、事前条件配置、固定ファイル上書き拒否、SQL/manifest改変検知、検証証明不一致拒否等。
- lint、型チェック、Next.jsビルド成功。
- Docker HTTP **16**、STEP10所有権 **18**、Stripe初期化 **29** 成功。
- CIにも完成SQL検証を追加。CIは実UUID・ハッシュを持たない**別の合成データ**で同じ生成器と検証器を実行する。CIの証明を今回の固定ファイルの証明として流用できない。
- GitHub CIの結果は当該コミットの実行結果と完了報告を参照。Docker配信元の制限による失敗でもCI全体を成功扱いしない。

## Hostedの状態・影響

読み取り確認時はACTIVE_HEALTHY、Authユーザー2・認証済み2・profiles2・Authセッション3。対象6テーブルは各0、購入・契約・課金顧客0、有効価格0、匿名AI OFF、migration17、全42アプリテーブルRLS有効。

Hostedへ完成SQLを送っていない。セッション更新・失効、ユーザー変更、メール、Stripe、OpenAI、Vercel、既存DBへの接続は実施していない。

## 再投入前の条件と承認

1. ユーザーが上記SHA256の完成SQLについて、新DBへの投入1回と後続検証を明示承認する。
2. Project RefとDBホストを再確認する。新DB以外へ送らない。旧.env.localや旧資格情報は使わない。
3. Auth A/B、profiles fingerprint、対象6テーブル0、決済/契約0、価格無効、匿名AI OFF、migration17、RLS/ACL、外部送信トリガーなしを再確認する。
4. 固定SQL・manifest・検証証明を照合する。SQLを再生成しない。前回失敗記録と新しい試行予約を区別し、既存記録を消さない。
5. 本人JWTが必要な後続試験の認証状態と、必要なAuth更新の承認範囲を再確認する。
6. 新規の送信試行記録を残して1回だけ送信する。失敗・結果不明なら即停止し、UUID単位の読み取り確認だけを行う。自動再試行・repair・reset・権限拡張は禁止。
7. Hostedでのcleanupは引き続き未承認。A/B・profiles・rate_limitsを削除しない。

今回は修正・隔離検証までで停止する。実環境のSTEP10所有権・引き継ぎ検証は未完了。
