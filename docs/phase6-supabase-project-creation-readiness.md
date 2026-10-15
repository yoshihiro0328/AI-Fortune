# 独立Supabase作成準備・引き継ぎ記録

**この文書は作成前の記録。利用者による作成後の最新状態・適用保留理由は[新DBの最終事前確認](phase6-new-db-preflight.md)を参照。** 新refは `ukdzggjfkcwjssjmnqim`。

2026-10-15。対象コミット `2b6eca7743e851b93115e836592c1a332cbeccb7`。**新プロジェクトはまだ作成していない。** パスワードの生成・取得・保存・入力も未実施。この文書は完了報告ではない。

## 作成対象と料金確認

| 項目                  | 確認結果                                                     |
| --------------------- | ------------------------------------------------------------ |
| 組織                  | AI Fortune / `xypcnfoznewknhiumsqd`                          |
| 作成予定名            | `yorisoi-integration-test`                                   |
| 作成予定リージョン    | Tokyo / `ap-northeast-1`                                     |
| 実契約                | DashboardとSupabase MCPでFreeを確認                          |
| 料金                  | 現行Free枠内なら作成$0、追加月額$0。Pro・有料オプションなし  |
| 支払い設定            | Spend cap有効、追加利用課金なし、支払方法・請求書なし        |
| 枠                    | MCPで現在1件。Freeの2 active projects枠の2件目として作成予定 |
| 新Project Ref・DB状態 | 未作成のため未取得・未検証                                   |

根拠：[公式料金](https://supabase.com/pricing)、[課金単位・Free枠](https://supabase.com/docs/guides/platform/billing-on-supabase)、[実契約画面](https://supabase.com/dashboard/org/xypcnfoznewknhiumsqd/billing)。作成画面にアップグレード・支払方法登録・有料オプションの要求はない。別料金・契約変更を求められた場合は送信せず停止する。MCPのget_cost/confirm_costはサーバーで未提供のため、機械的な見積IDは取得できなかった。

## 共有枠への影響

作成後はactive project枠を2/2使用する予定。DBは各projectで独立し500MB/projectだが、同じ組織のEgress・Storage・MAU等の枠は共有する。現在のUsage表示はEgress 0.039/5GB、MAU 71/50,000、Storage 0/1GB、DB約35/500MB、Realtime/Functionsは0。使用量表示には遅延がある。

空DB作成だけでも少量のシステム使用量・ログは発生し得る。将来の結合試験は共有クォータを消費し、超過時に既存projectにも制限・read-only等の影響が及び得る。Free維持で超過課金はしないが、稼働保証ではない。負荷試験は今回対象外。

## 作成フォームと操作上の停止理由

- Chromeの[作成画面](https://supabase.com/dashboard/new/xypcnfoznewknhiumsqd)に名称とTokyoを設定済み。
- GitHub未接続、Postgres Default、Data API ON、Automatically expose new tables OFF、自動RLS OFFを準備。migrationによる明示GRANT/RLSを後工程で確認する。
- パスワード欄は空。作成ボタン未送信。既存キー・データを取得・複製していない。
- Supabase MCPの料金確認・作成確認機能が利用できず、CLIの読み取り専用一覧も応答しない。ブラウザーで新規DB認証情報を入力・確定する手順はComputer Useの利用者引き継ぎ対象のため、その操作の前で停止。
- 利用者がパスワード管理アプリ等で専用の強いパスワードを生成・保管して入力し、名称・Free・Tokyoを確認して作成する。パスワードをチャットへ送らない。有料表示が出た場合は作成しない。

## 作成後に残る読み取り確認

新refが `rnvrdrfdbapfafwjbygo` と異なること、組織・Free・Tokyo・ACTIVE_HEALTHYを確認する。新ref限定でpublicテーブル、migration履歴、Authユーザー数、API/Auth初期設定を読み取り確認する。Supabase管理用schema/tableは自動作成されるため、「空」はアプリ用テーブル・実ユーザー・利用者データがないことを指す。秘密鍵を表示・記録せず、既存キーと別のprojectに属することを確認する。

## SQL16件の適用準備（未実行）

[manifest](phase6-external-migration-manifest.md)の16件すべてについてSHA256、件数、ファイル名の昇順一致を再確認した。SQL本文は変更していない。クラウドでSQLを実行していない。作成承認とSQL適用承認は別。

13番の注意点：

1. 新Stripe Sandbox作成・ID確定・初期化の承認を別途取得する。それまではAuthユーザー・診断・購入・契約データを投入しない。今回Stripe操作は行わない。
2. 16件の適用後、新refとDB所有者接続を照合し、アプリ・Webhook接続を閉じる。DB所有者の初期化transaction内で対象テーブルをロックし、`auth.users`、`diagnoses`、`payments`、`stripe_events`、`billing_customers`が空であることを再確認する。加えてsubscriptions/invoices等の業務データも空であることを確認する。
3. `payment_environment.mode='sandbox'`のままstripe_account_idを新SandboxのIDにする。ユーザー等が存在する場合は保護triggerが変更を拒否する。triggerを無効化して回避しない。
4. 既存Sandbox価格を非activeにする。既存価格のIDや金額は書き換えず、新version IDで新Sandboxの商品・価格をINSERTする。`guard_price_environment`は既存価格の変更を禁止している。
5. report=単発980円、Plus=月額980円、JPY、test環境、各kindのactive価格1件を検査する。非activeのLive seedは非activeを維持する。旧1,980円レポートの検証をする段階では専用のtest価格を用意する。
6. Portal設定・環境変数も新Sandbox専用値と整合させ、検査成功時だけcommitする。不一致・途中失敗ならrollbackして停止。サービスロールによる環境書換えや元migration改変はしない。

15番の匿名相談設定はOFFのまま。価格有効期限は2026-10-22 00:00 JST。期限後の実接続試験は価格の再確認と新DB設定更新の別承認が必要。

## 適用前バックアップ・復旧

Freeの自動バックアップ/PITRを復旧保証として扱わない。将来のSQL適用直前に、新ref・設定・空DB状態・migration履歴を記録し、承認された端末で新DBだけの手動バックアップを暗号化保存する。ダンプの復元可能性をDocker隔離DBで確認する。APIキー・パスワードはダンプやGitに記載せず、必要な設定情報も別管理する。既存DBはバックアップ元にも復元先にも使用しない。

適用失敗時は残りを止め、到達versionとエラー（秘密情報除去）を記録する。reset・履歴repair・再実行で隠さない。新テストDBだけを対象とした復元・再作成計画を提示し、承認後に実行する。新規project削除や再作成は今回の承認に含めない。

## 既存環境・次の承認

既存Supabase、固定Preview、デモPreview、main、Stripe、OpenAIには変更なし。SQL適用、ユーザー作成、メール送信、AI生成、決済、Vercel作成・デプロイは未実施。アプリコードは変更せず、既存484テスト・HTTP16シナリオは今回再実行していない（既報の合格結果を維持）。

作成後の読み取り確認は現承認内で継続可能。次工程は新refを明記した16件のSQL適用・バックアップ/復旧方法、独立Stripe SandboxおよびDB初期化、管理下2メール宛て最大4通の送信先と件数などを段階ごとに別途承認する。第2開発単位には進まない。
