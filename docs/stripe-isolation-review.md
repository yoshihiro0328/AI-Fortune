# Stripe環境分離：実DB適用前レビュー

確認日：2026-10-13。対象：`yoshihiro0328/AI-Fortune` / `codex/partner-mind-mvp`。
作業開始HEAD：`9d817551fd14d102ed6c1e49b97389dfe17eb538`。

## 1. 回収した未コミット変更

Stripe Client、料金カタログ、単発Checkout、月額Checkout・解約・Portal、Webhook、契約同期、購入済みレポートの環境チェック、環境変数例、既存テスト、`20261013074636_stripe_environment_isolation.sql`を回収して修正した。未コミット変更をリセットせず、既存の9d81755を土台にしている。

今回の範囲はローカル実装・隔離検証・GitHub反映まで。今回の指示以後、Supabase SQLコネクタ、実DBへのmigration、Vercel設定変更、Stripe実接続の書き込みは実行していない。Auth・Custom SMTP・既存ユーザー・購入データも変更していない。

## 2. SQLの問題点と修正

| 問題                                                          | 修正                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 失敗通知でPaymentIntentを固定すると、次の試行を誤って拒否する | 失敗時は状態のみ更新し、Intent・Customer・Sessionを固定しない                                    |
| Checkout IDの保存前に正当なWebhookが届くと拒否される          | サーバーでStripeを照合後、未保存IDを決済・返金と同じトランザクションで保存                       |
| 古い失敗イベントが支払済み購入を変更する可能性                | paid/refundedに対する遅いfailureは状態を変えない                                                 |
| 返金より遅く成功イベントが届く                                | refundedを終端にし、レポートを再生成・再付与しない                                               |
| 受信履歴だけが残る／重複通知で二重処理される                  | 行ロック、イベントID一意制約、購入IDと環境の照合、受信履歴と権限変更を同じトランザクションに統合 |
| migrationの途中失敗・再実行                                   | BEGIN/COMMIT、5秒のロック待機上限、60秒の実行上限、部分適用を検知して停止                        |
| 旧RPCがLiveでも呼べてしまう                                   | 9引数の旧RPCをSandbox限定で維持し、Liveではv2のみ許可                                            |
| 所有者・料金履歴を誤って書き換えられる                        | 顧客・契約・請求書の所有者、決済済み購入の金額、価格バージョンの既存ID・料金を保護               |

NULLの状態・種別、金額・通貨・購入者・環境の不一致は拒否する。失敗した処理は受信履歴ごとロールバックされる。

## 3. 環境分離設計

1 DB = 1 Stripe環境。既存DB `rnvrdrfdbapfafwjbygo` はSandboxのまま維持する。Liveには別の空のSupabaseプロジェクトを使う。新プロジェクトは今回作成していない。

アプリの`STRIPE_MODE`、Vercelの実行環境、APIキーのtest/live prefix、APIで取得したStripeアカウントID、DBの`payment_environment`、Price/Product ID、Stripeオブジェクトの`livemode`を照合する。未設定・不明・不一致は決済を停止する。Live Checkoutにはさらに`STRIPE_LIVE_CHECKOUT_ENABLED=true`が必要。現在のPreviewには設定しない。

既存の`is_test`を使用し、`billing_customers`・`stripe_events`にも追加する。新規購入には`payments.price_version`を保存する。Liveの料金2件は別レコードとして登録し、Sandbox DBでは非アクティブにする。

新しいテーブルはRLS有効、ブラウザ権限なし。`service_role`は環境設定を読み取れるが変更できない。追加した関数はすべてSECURITY INVOKER・固定search_pathで、SECURITY DEFINERによる昇格はない。決済RPCはservice_role専用。既存RLSポリシーは変更しない。

## 4. Sandbox互換性

既存Sandbox Price ID、金額、所有者、支払状態、購入済みレポート、解約予約を変更しない。旧1,980円および既存980円の`price_version=NULL`はSandboxの履歴として扱い、既存Checkoutとの照合で維持する。旧9引数RPCを残すため、DBを先に適用しても旧Sandboxアプリが利用できる。

検証は実レコードのコピーではなく合成データで実施。migration前後の既存購入フィールドを比較し、レポートJSON・契約状態・解約予約・相談枠を確認した。匿名診断の既存アカウント保存処理も、診断所有者と一致するNULL→確認済みユーザーへの移行を許容する。

## 5. Live DBの初期化

`supabase/review/initialize-empty-live.sql`は通常migrationには含めず、承認後に新規・空のLive DBでのみ実行する。

1. 費用と空き枠を確認し、承認後に別プロジェクトを作る。
2. 既存migrationを順番に適用し、環境分離migrationまで完了する。ユーザーや購入データはコピーしない。
3. 初期化SQLがユーザー・診断・購入・顧客・契約・Webhook履歴の不存在を確認する。
4. Sandbox料金を無効化し、DBをLiveアカウントへ設定してLive料金2件だけ有効化する。
5. Portal設定を空にし、別途作成・検証したLive用設定を登録する。Sandbox Portal IDをコピーしない。
6. 本番DB用のAuthリダイレクト・SMTP等は独立して設定・検証する。既存Sandboxの設定は変更しない。

| 種類       | Live Product        | Live Price                     | 金額               |
| ---------- | ------------------- | ------------------------------ | ------------------ |
| Plus       | prod_VPQvCUb8oZ87Zy | price_1UOc3HIGjFw40K1178ivu0ee | 980 JPY / month    |
| 単発13項目 | prod_VPR4SfWQ7uFLnf | price_1UOcC9IGjFw40K11jgxP3dpg | 980 JPY / one_time |

これらは前回の読み取りで確認した作成済み商品。今回Live側へのAPI書き込みはしていない。

費用：2026-10-13の[Supabase公式料金](https://supabase.com/pricing)ではFreeは月額0ドル、稼働2プロジェクトまで、DB 500 MB、1週間未利用で休止。現在の空き枠・組織契約は今回再確認していない。Free枠を使える場合だけ追加0ドルの候補となる。Proは月25ドルから、追加プロジェクトは月10ドルから。契約変更や有料プロジェクト作成は承認が必要。分離すると環境変数・migration履歴・監視・バックアップ・Auth設定を2組管理する必要がある。既存会員の本番移行は別途本人・データ保護方針の設計が必要で、今回自動移行しない。

## 6. Webhook検証

署名を生の本文で検証し、EventとObject両方の環境を確認する。単発購入はPaymentIntent、Checkout、明細、DBの購入を照合する。Chargeにメタデータがない返金はPaymentIntentの購入IDで確認する。PaymentIntentやCheckoutを取得できない正当な通知は500で再送を求め、成功として捨てない。

契約は毎回最新のStripe状態・請求書を取得し、顧客・所有者・Price/Product・JPY・数量1・月次更新・請求済み980円を確認する。古い通知の本文で解約予約を巻き戻さない。未払いの期間へ相談権限を延長しない。

必要イベント：

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

SandboxとLiveは別のURL・Secretを使用する。Liveは正式Production URLの`/api/webhooks/stripe`で、固定Previewを送信先にしない。Live Webhookは今回作成しない。返金はStripe→Webhook→DB refunded→レポートrevokedの順。DBだけを返金済みにする運用はしない。部分返金の新機能は追加せず、従来どおり全額返金運用を前提とする。

## 7. 検証結果と限界

- lint・typecheck：成功。
- 自動テスト：313件成功（うち既存購入の所有者不整合に関する追加29件）、外部接続用33件はスキップ。既存テストに、環境境界・Checkout・Webhook・契約同期・隔離SQLの回帰テストを追加。
- `npm run build`：この端末ではTurbopackが内部ポートの権限制限で停止。
- `npm run build -- --webpack`：成功（同じNext.jsの公式Webpackビルド）。
- 隔離SQL：PGlite 0.5.9 / PostgreSQL 18.6。SupabaseのAuth用テーブル・ロール・auth.uidのみテスト用に用意し、アプリの既存migrationと今回SQLはそのまま実行。実DBのバージョン・拡張・ロック競合・ネットワークまで同一ではない。
- Stripe：Sandbox/Liveともモック検証。外部Stripe・実DBを使う既存33テストは、今回の外部変更禁止に合わせて実行していない。実Sandbox接続の回帰成功とは区別する。
- 固定Preview：更新・エイリアス変更・新コードの公開確認は今回の範囲外。現行環境を維持する。
- 本番APIキー、Live Checkout、実請求、Productionデプロイ、mainマージ、検索公開は未実施。

## 8. GitHub反映

前回実装は `773b99b`、報告を含む基準コミットは `d5187f00b7f1eb443b43109a699c305852661692`。2026-10-13の追加調査時に、開発ブランチのリモートHEADがこの基準コミットと一致し、[GitHub CIが成功](https://github.com/yoshihiro0328/AI-Fortune/actions/runs/38380650920)していることをGit CLI / GitHub CLIで確認した。前回報告のpush未完了状態は解消している。

今回の所有者不整合への補修は同じ開発ブランチへ通常のGitで送信し、そのコミットのCIを確認する。最終SHAとCI URLは完了報告を参照。秘密ファイルはコミットしない。実DBは未適用のため、既存の`vercel.json`の`git.deploymentEnabled`による開発ブランチ自動デプロイ停止を維持する。今回Vercel設定は変更しない。

## 9. 実DBへ適用していない変更

今回SQL・トリガー・列・RPC・Live価格登録はローカルの隔離DBだけに適用した。最後の読み取りでは実DBの環境分離テーブル・新列・適用履歴は存在しなかった。ただし中断した外部処理の最終結果を今回コネクタで再確認していないため、適用前には必ず再照合する。

読み取り用の`supabase/review/preflight-stripe-isolation.sql`を用意した。履歴だけでなく列・関数・トリガー・件数・内容の照合値を確認する。既存payments.is_testなどは今回追加する列と混同しない。

## 10. 承認後の安全な適用順序

1. GitのHEAD、SQL内容、実DBの適用履歴を照合。履歴がなくても一部のオブジェクトが存在したら停止する。IF NOT EXISTSで隠して続行しない。
2. 新規決済操作のない作業時間を選び、バックアップと復旧先を確保する。上記preflightでユーザー・支払い・レポート・契約・請求書の件数と照合値を保存する。
3. SQLを1トランザクションとして一度だけ適用する。利用ツールが外側のトランザクションを管理する場合は、レビュー済みのトランザクション境界を調整し、二重のBEGIN/COMMITを安易に送らない。
4. 成功後にschema、RLS、権限、既存データの照合を行う。価格の新メタデータ・Live非有効2件以外、既存値が変わっていないことを確認する。
5. migration履歴をローカルの版番号と対応づける。既存の過去migrationはリモートでタイムスタンプが異なるため、無条件のdb pushを行わない。
6. Preview設定を確認し、この開発ブランチの自動デプロイ停止を解除するコミットを作る。Previewだけをビルドして検証し、成功後に固定URLへ割り当てる。
7. 実Sandboxの単発980円・Plus980円・Webhook再送・更新失敗・解約・再契約・返金・旧1,980円レポート・相談枠を再確認する。

失敗時：COMMIT前のエラーはROLLBACKし、同じ接続でトランザクションを終了させる。次にpreflightを再実行し、部分状態がないことを確認してから原因を修正する。接続切断や結果不明では、再送せず先に履歴・オブジェクト・データを照合する。適用成功後のアプリ不具合は旧Sandboxデプロイへ戻す。互換RPCを残しているので、新列・履歴を削除する破壊的な逆migrationは行わない。

## 11. Vercel設定

今回変更していない。前段階で追加済みのPreview設定は、適用段階で値とブランチ範囲を再確認する。

| 設定                              | Preview / 開発         | 将来のProduction                    |
| --------------------------------- | ---------------------- | ----------------------------------- |
| STRIPE_MODE                       | sandbox                | live                                |
| STRIPE_ACCOUNT_ID                 | acct_1UNSvsIYwtQeIHKP  | acct_1JGOwIIGjFw40K11               |
| STRIPE_SECRET_KEY                 | 既存testキーを維持     | 別のLive restricted keyをSecret登録 |
| STRIPE_WEBHOOK_SECRET             | 既存Sandbox用を維持    | 別のLive送信先のSecret              |
| STRIPE_LIVE_CHECKOUT_ENABLED      | false                  | 承認・最終検証まではfalse           |
| NEXT_PUBLIC_SUPABASE_URL / 公開鍵 | 既存Sandbox DB         | 別Live DB                           |
| SUPABASE_SERVICE_ROLE_KEY         | 既存Sandbox DB用Secret | 別Live DB用Secret                   |
| NEXT_PUBLIC_APP_URL               | 固定Preview            | 確定したProduction URL              |
| SESSION_SECRET / CRON_SECRET      | 既存値を維持           | 環境ごとの別Secret                  |
| PUBLIC_INDEXING_ENABLED           | false                  | 今回はfalseのまま                   |

OPENAI、運営情報、問い合わせ・メール関連設定も将来の本番環境で別途確認する。現在のCustom SMTPは設定・到達確認済みという運営者の報告を保持し、今回変更しない。公開鍵は現行リダイレクトCheckoutでは不要。

本番restricted keyの候補権限：Checkout Sessions・Customers・Subscriptions・Customer Portal Sessionsの書き込み、Prices/Products・Invoices・PaymentIntents・Portal Configurations・自アカウントの読み取り。Refundの書き込み、APIキー管理、Webhook管理、Connect管理、Payoutsはアプリに不要。実際の権限名・不足権限は制限付きSandboxキーによる別途の実接続試験で確認する。[Stripe公式の最小権限手順](https://docs.stripe.com/keys/restricted-api-keys)に従い、不要な権限を追加しない。秘密値はチャット・GitHub・報告書に貼らず、承認後に各環境のSecretとして登録する。

## 12. 承認が必要な残作業

- 実DBの最終読み取り照合、バックアップ確認、今回migrationの適用。
- Previewの自動デプロイ再開・固定URL切り替え・実Sandbox回帰。
- 別Live DBの作成と費用、Auth・SMTP等の独立設定。
- Production URL、Liveキー・Portal・Webhook、Stripe KYC／取締役確認などの実状確認。
- 販売開始時の公開文言・運営情報・集計の環境タグの最終監査。今回のUIはテスト公開表示を維持している。
- 本番販売・Live Checkoutの最終試験はさらに別の明示承認が必要。検索公開・mainマージも別途扱う。

今回完了したのは「レビュー可能なローカル実装・隔離検証・ローカルコミット保存」。GitHub反映はGit認証待ち。本番販売開始や実Sandboxへの新コード反映完了を意味しない。

## 13. 既存購入の所有者不整合への補修（2026-10-13）

### 調査対象と再現

ユーザーから、既存購入12件のうち1件について、payments.user_idがNULL、diagnoses.user_idが設定済み、購入はpaid、診断はreport_ready、paid_reportsが存在、Checkout/PaymentIntent IDは未設定、作成日2026-10-08という報告を受けた。実DBのSQL照会・変更は行わず、この条件を合成データで再現した。実際のレコードID、決済の成立経緯、Stripe側の証跡は未確認であり、テスト用データや実決済とは断定しない。

| 操作                                       | 修正前の影響                                                                | 修正後                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| migration適用                              | トリガー作成時には既存行を検証しないため、この不整合自体では失敗しない      | 購入・診断・レポートの既存値を維持                             |
| 診断所有者のレポート閲覧                   | SELECTでトリガーは発火しない。既存RLSとアプリのowned/ownsは診断所有者を確認 | 変更なし。他人・未ログインの匿名セッションには権限を付与しない |
| レポート再生成                             | claim_report/finish_reportは購入行を更新せず、購入状態を参照・ロックする    | 既存の再試行処理は成功。完成済みレポートは再取得されない       |
| 購入行のupdated_atのみ更新                 | diagnosis owner mismatchで失敗                                              | 移行時に記録された行の内容が同一なら許可                       |
| 所有者・金額・状態・Stripe IDなどの変更    | 所有者不一致等で失敗                                                        | 今回の例外では許可しない                                       |
| 新規の所有者不整合・移行後に発生した不整合 | 拒否                                                                        | 引き続き拒否                                                   |

閲覧経路は `src/app/api/diagnoses/[id]/report/route.ts` → `owned()` → `owns()`、再生成は `src/lib/ai/pipeline.ts` → `claim_report` / `finish_report` をコード確認した。ローカル実DBエンジンでRLS・RPC・所有権関数を検証しており、実サイトでのログイン/E2Eは今回の範囲外。

### 変更内容と制限

未適用の `20261013074636_stripe_environment_isolation.sql` を修正した。`payment_legacy_owner_exceptions` に、移行時点で条件に一致する既存Sandbox購入のID・診断所有者・購入行のスナップショットを一度だけ記録する。診断・レポートに共有ロックを取得し、取得中の所有者変更を防ぐ。既存の5秒のロック待機制限と60秒の実行制限を維持し、失敗時には全変更をロールバックする。

例外はUPDATEのみ。OLDとNEWの全購入フィールドが、updated_atを除き保存時点の値と一致し、診断の所有者も変わっていない場合だけ通る。新規INSERTや単にuser_idがNULLという理由では通らない。将来列を追加すると、スナップショットと異なるため、その列の扱いを再レビューするまでは例外が閉じる。

例外テーブルはRLS有効。anon/authenticatedのアクセスを禁止し、service_roleもSELECTのみ。アプリから例外の追加・変更・削除・TRUNCATEはできない。購入自体が削除される場合は外部キーのCASCADEで例外も削除される。既存RLS、SECURITY INVOKER、環境照合は維持した。

購入者の自動補完、Stripe IDの推測、既存支払状態の書き換えは行わない。以前からある明示的なアカウント保存RPCによる、確認済み診断所有者へのNULL→user_id設定は厳密な所有者一致経路で動作するが、migrationはこのRPCを実行しない。この動作もローカルのロールバックテストだけで確認した。

### 残る制約

この補修は不整合の事実を消すものではない。該当購入の返金・Stripe ID追加・その他の金融情報更新は、この例外では依然拒否する。正当な処理を進めるには、別途、購入の成立経緯とStripe証跡・所有者を確認し、具体的な補正内容を承認してから扱う必要がある。v2返金RPCが拒否された場合、受信履歴もロールバックされ、レポートを誤って無効化しない。

旧9引数RPCも購入行へStripe IDや返金状態を書こうとすれば拒否される。ID未設定のまま成功扱いにして証跡を補ったことにしたり、Webhookエラーを握りつぶしたりしない。

### 検証と適用前確認

追加29件で、12件全体の購入・診断・レポート・既存RLSの不変、1件だけの例外登録、時刻のみの更新、所有者と他人の閲覧権限、完成済み/再試行レポート、12種類の不正更新拒否、移行後の不整合拒否、診断所有者変更時の例外失効、既存アカウント保存経路、例外テーブルの権限、返金エラー時の原子性を確認した。既存DBテストには、migration途中失敗時に例外テーブルも残らない確認を追加した。

修正前は時刻のみの更新が実際に `diagnosis owner mismatch` で失敗し、修正後に成功した。lint・typecheck・313テスト・Webpackビルドは成功。33件の外部接続テストは未実行。通常ビルドは端末のTurbopack内部ポート権限制限で停止したため、GitHub CIで通常ビルドを確認する。

読み取り用preflightには、不整合件数と例外候補件数だけを返すSQL、および例外テーブルの部分適用検知を追加した。このSQLも実DBでは実行していない。将来の適用時は、履歴・オブジェクトの未適用確認に加え、報告された不整合1件と候補件数が一致するかを確認する。一致しなければ対象を調査してから進む。すでに旧版が適用済みなら本ファイルを再実行せず、別途前進migrationを設計する。

参考：[Supabaseのトリガー仕様](https://supabase.com/docs/guides/database/postgres/triggers)、[RLS仕様](https://supabase.com/docs/guides/database/postgres/row-level-security)。今回の判定は、このリポジトリのコードと隔離PostgreSQLでの実行結果に基づく。
