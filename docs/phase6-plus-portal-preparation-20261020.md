# Phase 6: 月額Plus・Customer Portalの準備

基準: `6da5bdd1e814a46301e665b6be41ff53f8c4b3d4` / CI `39379931083`。本書は次回の承認案であり、外部実行の記録ではない。今回、実資格情報、実Auth、Stripe、外部DBを使用していない。STEP 10、r5の購入、保持済み3行、readyレポートは再実行・再投入・削除していない。外部33件は未検証のまま。

## 実装した実行部品

`scripts/phase6/subscription-runtime/` に既存購入ランチャーとは別の処理を追加した。

- `launch.mjs`: 起動前照合→専用listener→アプリ/中継のready→対話制御→独立した終了処理。起動前不一致やlistener不一致では本人操作へ進まない。
- `runtime.mjs` / `server.mjs` / `fetch.mjs`: 既存.envをコピーしない専用アプリ、localhost:5218、127.0.0.1:5219の中継、Mac OSの外向き通信制限。アプリは新Supabaseと列挙したStripe操作だけを中継へ要求する。中継を迂回したHTTP/TCP/子プロセスも拒否。秘密保管ディレクトリを子アプリから読めない。
- `policy.mjs`: C/D・Customer・価格・Portal設定・Subscription IDの限定、ログイン/更新上限、Webhook署名検証前提の6イベント限定。旧環境、OpenAI、任意RPC、全件イベント検索、返金、対象外の書き込みを拒否。
- `journal.mjs`: `wx`で新規試行のみ作成、書き込み前の予約とfsync、操作数上限、失敗・不明で停止。既存試行を再利用しない。起動前に実スキーマのGETを実行し、保持資料との一致を要求する。`paid_reports`は存在しないuser_id列ではなく元レポートIDで照合する。
- `listener.mjs` / `listener-worker.mjs`: 導入済み固定CLIのSHA256、対象Account、API版 `2026-09-30.endive` の一致を要求。`@self`、6イベント、5219への転送のみ。stdout/stderrは上限付きメモリ解析だけで秘密値を保存・表示しない。親の切断でCLIを終了する。
- `lifecycle.mjs`: manifestに束縛したCustomer/Clock/Subscriptionだけを照合・操作する部品。時計更新を予約し、readyの確認なしで次のadvanceを送らない。終了結果不明のSubscriptionを再度終了させない。自動ネットワーク再試行なし。
- `control.mjs`: `exec_command`の`tty:true, login:true`と同じsession_idを終了まで維持する。status、途中確認、finishを処理する。20分の総時間制限、入力切断・子プロセス終了・タイムアウトで停止する。処理中の切断を後の成功で上書きしない。
- `isolated.mjs` / `offline.mjs`: 17 migrationを適用したPGlite、合成Auth、ローカルCheckout/Portal代替、実Next・実Chromeによる一連の検証。実Stripeの配送・画面・Auth署名の検証とは区別する。

既存 `subscription-live.test.ts` は実行していない。旧価格ID、固定Preview、アカウント全体のEvents検索、`.env.local` を新処理に継承しない。将来の実行はこれらの部品へ承認済みの安全な資格情報受渡し・対象限定操作を接続する。外部資格情報・CLI権限・実際のIDを用いた起動は未検証であり、購入前の停止条件に残す。

## 現行仕様と判定

DBの `consultation_entitlement` とアプリの請求同期を基準とする。契約通知の到着順を信用せず、対象SubscriptionとInvoiceをStripeから再取得して同期する。イベントID/本文ハッシュとDB RPCで重複を処理する。

| 状態                                                 | 現在の利用枠                 | アカウント/請求操作                              |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| 未契約、未払の初回、不完全、trialing、paused、unpaid | Free、JST暦月3回             | 契約導線。既存の非終端契約があれば二重契約を拒否 |
| active、支払済み期間内、期間開始済み                 | Plus、契約期間30回           | 契約・請求状態、Portal、期間末解約               |
| past_dueだが支払済み期間内                           | Plusを支払済み期間内だけ維持 | 支払い方法の管理・解約                           |
| past_dueで支払済み期間終了                           | Free3回                      | 未払状態と請求履歴、Portal                       |
| 期間末解約予約、支払済み期間内                       | Plus維持                     | 解約予定表示。予約だけで即時Freeにしない         |
| canceled、契約終了、cancel_at到達                    | Free3回                      | 終了表示、再契約                                 |
| 再契約activeかつ支払済み/開始済み                    | Plus30回                     | 新Subscriptionとして表示                         |
| Stripe上の期間開始がDBの現在時刻より未来             | Free                         | 将来期間を現在のPlus権限と読み替えない           |

Plusは相談利用枠であり、単発の詳細レポート購入権限を付与しない。今回AI相談POST・生成を実行せず、利用枠RPCと閲覧/請求画面を確認する。レート制限と30回/3回の上限は変更しない。

Test ClockはStripeの時刻を進めるが、Supabaseの `now()` は進まない。したがって、実環境では「初回の現在Plus権限」と「時計を進めた後の契約/請求同期」を分ける。未来期間のPlus権限を無理に成功させるDB時刻変更、日付書換え、権限緩和は行わない。期間境界の全状態は今回の隔離DB試験で検証した。実時間での将来の権限回復は、必要なら後続の観測対象とする。

## ブラウザーと通信

C専用の新しいCookie領域で `/subscription-test/c` → `/account` のログイン → `/plans` → 契約同意 → Checkout → `/account?subscription=complete` → Portal → `/account` を通す。Dは独立した領域、未認証はCookieなし。A/B用のブラウザー、Cookie、ユーザー、既存Customerには触れない。

| 操作          | 必要な通信                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ログイン/状態 | POST/GET `/api/auth`、新DBのtoken/password・user・上限付きrefresh                                                                   |
| アカウント    | GET `/api/diagnoses?offset=0`、`/api/billing`、`/api/consultations`、自分のprofiles/履歴/契約/請求/利用枠                           |
| プラン        | GET `/plans`、service_settings・対象Plus price、POST `/api/billing` checkout                                                        |
| 契約作成      | 対象Customer/価格の読取、customer限定Subscription一覧、Checkout作成。既存Customerを事前に束縛し、自動Customer作成は中継で許可しない |
| Portal        | 設定IDの読取、対象CustomerのPortal Session作成、固定のlocalhost復帰先                                                               |
| 同期          | 対象Subscription取得、subscription限定Invoice一覧、apply_subscription_snapshot、取得したoperation_lockだけの解放                    |
| 認証付随      | fresh匿名セッションのclaim結果0、限定rate_limits。claimによる既存診断更新は許可しない                                               |
| 通知          | checkout.session.completed、customer.subscription.created/updated/deleted、invoice.paid/payment_failed                              |

Cの全ブラウザー経路とDのプランボタン拒否を実Chromeで確認した。D/未認証のCheckout・Portal・cancelをAPIでも拒否した。**Dの契約POST拒否は専用ランタイムの購入者限定ガードによるもの**であり、一般製品でD自身の契約まで禁止する仕様ではない。Dの契約/請求GETは本人に束縛され、Cの行を返さない。RLSは実PostgreSQLのauthenticatedロールと合成JWT claimsで確認した。実Supabaseの本人JWTと実Portalの本人確認は次回対象。

ローカルVisit分析送信は無効化し、必要のないイベント書き込みを除外した。匿名AI、相談作成、レポート生成、任意RPC、既存Preview、Stripe Live/Connectは許可しない。

## 次回の対象・件数・上限案

対象は `acct_1UQlQdI73kTcvXz8` / `ukdzggjfkcwjssjmnqim` / `http://localhost:5218` のみ。今回は実際の新しいIDを作成していない。次回は作成応答を保護manifestに追記し、対象と親子関係を照合してから使用する。既存の月額980 JPY価格を対象Accountで読んで一致させる。旧コードの価格IDから推測しない。

| 対象                      | 最大件数/操作                                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 専用AuthユーザーC/D       | 2名。購入試験専用に管理者APIで確認済みとして作成する案。メール送信なし。この扱いは条件付き承認済みで、実メール認証成功とは扱わない。各profiles1行、既存A/Bは不使用                                                                             |
| ログイン/refresh          | C/D各1回、各refresh最大2回。新規ユーザー作成以外のAuth設定変更・パスワード再設定なし                                                                                                                                                           |
| Test Clock                | 1件。advance最大3回、各回1周期程度・32日以下。ready確認の読取は最大12回/60秒、未完了なら停止                                                                                                                                                   |
| Customer                  | C専用1件、上記Clockとrunに束縛。Dには作らない。billing_customers1行                                                                                                                                                                            |
| 価格/Product              | 既存の新Sandbox専用月額価格1件を一時有効化→終了時無効化。新価格/Product作成なし。DB price_versionsの当該activeも同様                                                                                                                           |
| Portal Configuration      | 専用1件。プラン変更/顧客情報変更OFF、請求履歴/支払方法/期間末解約ON。service_settingsのportal_configuration_idだけ一時設定→元へ戻す。既存設定を書き換えず、新設定を終了時無効化                                                                |
| Checkout/本人テスト支払い | 初回・再契約の計2件/各1回。結果不明で再作成・再送しない                                                                                                                                                                                        |
| Subscription              | 最大2件。初回契約→更新成功→更新失敗→終了、再契約→期間末解約→終了                                                                                                                                                                               |
| 支払方法切替              | 失敗用1回・成功用への復帰1回。公式テスト方法だけ。実カード情報なし                                                                                                                                                                             |
| 解約                      | 期間末解約各契約1回まで。即時終了は失敗後の初回契約1回まで。途中中断時には未終了の今回契約のみ別枠で最大2件を一度ずつ終了する必要がある（終了結果不明は再送しない）                                                                            |
| Portal Session            | 最大2件、Cだけ。ナビゲーションと復帰が主対象。Portal内操作による追加の契約・追加請求はしない                                                                                                                                                   |
| 請求/支払い               | 初回980、更新成功980、再契約980のテスト上の成功計2940 JPY、更新失敗980 JPYを1回想定。Invoice最大4件。自動再請求等の予期しない増加では停止                                                                                                      |
| 通知                      | 6種、今回Customer/Subscription限定、固有イベント最大40、同一ID最大3配送（初回・重複1・旧通知再投入1）。署名検証済みの保存通知をローカル中継へ再投入して順序逆転/重複を試験し、Stripeが実際に再配送したと読み替えない                           |
| DB付随                    | subscriptions最大2、subscription_invoices最大4、stripe_events最大40、analytics_eventsのplus_checkout_started最大2。必要なAuth/監査/rate_limitsと取得したoperation_locksの限定更新・解放。profiles内容、診断、相談、購入、ready本文は変更しない |

レビュー後のローカル試験も合成Invoiceは試行全体で4件。未来期間の境界は5件目を作らずSubscriptionの合成通知で確認する。実イベント数/再請求条件はSandbox設定を事前に読んで確認する。購読6種だけではStripe内部の全通知種類を止められないが、転送・処理は6種に限定する。

## 権限と秘密の取扱い

用途別の制限付きキーを最大3件とする案。以前の単発試験の2キー承認を流用しない。下表は**必要API操作の上限**であり、すべてのRAK画面ラベルや依存権限を実証済みという意味ではない。

| 用途                 | 必要操作の上限                                                                                                                                  | 未確定/停止条件                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| アプリ               | Accounts/Prices/Customers/Invoices読取、Checkout Sessions書込、Subscriptions読取/期間末解約書込、Customer Portal Session書込・Configuration読取 | PortalのSessionとConfigurationの権限分離や追加依存権限は現行RAK画面/公式資料で照合。PaymentIntent/返金/送金/Debugging Toolsを追加しない                                                                               |
| CLI受信              | Accounts/Events/Checkout Sessions読取、Debugging Tools Write（stripecli_session_write）                                                         | 前段の経験でCLIセッション作成に必要と確認済み。ただし現行キー・今回の6イベント・API版でのlisten開始は未検証。権限自体は6イベントだけに限定されない                                                                    |
| 準備/Clock・終了処理 | Accounts/Prices読取、Customers/Subscriptions/Test Clocks/Payment Methods/Portal Configurationの必要作成・限定更新                               | Test ClocksのRAKラベル、PaymentMethod失敗手段の依存権限、Portal作成・無効化の依存権限は未確定。公開Stripe Apps権限表をRAKにそのまま転記しない。価格有効化/無効化は本人Dashboard操作で行い、Prices書込キーを追加しない |

キー発行前にこの上限で必要操作が可能か確認する。未確定の権限が解決できない、上限超過、広い標準キー、Live、Connect、追加費用/有料化/本人確認が必要なら購入前に停止する。キーの正否を実操作で試しながら権限を増やす方式にはしない。

本人だけがキー画面、Macの「パスワード」、専用の入力フォームを扱う。Workはそれらの画面・AX・スクリーンショット・クリップボードを取得しない。秘密未入力時にフォームのローカル待受け/安全性だけ確認し、入力後は保存完了フラグだけ読む。秘密値は引数/URI/Git/通常ログへ入れず、0700領域・0600一時ファイルまたは親プロセスメモリ、子アプリには代理値だけを渡す。終了時は本人が各キーを失効し、秘密値を含まない記録と各キー1回の失効確認で判断する。新しい標準キーは不使用。

公式資料で確認した範囲: [制限付きキー](https://docs.stripe.com/keys/restricted-api-keys)、[Stripe Appsの権限表（RAKと区別）](https://docs.stripe.com/stripe-apps/reference/permissions)、[契約Webhook](https://docs.stripe.com/billing/subscriptions/webhooks)、[Portal構成](https://docs.stripe.com/customer-management/integrate-customer-portal)、[Test Clock](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage)。SDKは既存23.0.0 / API 2026-09-30.endiveを維持し、CLIの表示API版不一致で停止する。今回CLIの導入・実起動はしていない。

## 一括承認案と終了条件

次回の一括承認は、上記C/D2名の準備、専用Customer/Clock/Portal設定、必要最小限の3キー、既存月額価格1件の一時有効化、2契約・2回の本人テスト支払い、Clock3更新・失敗方法切替・契約終了、限定通知再投入、本人JWTによるRLS、終了処理までとする。**現在は条件付き承認済み・未実行。** 権限等の発行前条件が未確定のため、キー発行前で停止している。詳細は `phase6-plus-prekey-review-20261020.md`。 事前照合に合格するまで本人ログイン・Checkoutへ進まない。権限未確定項目が解決しなければ、購入前に停止して残存設定/キーを片付ける。

最初に旧観測・元manifestとA/B・保持3行・購入/レポートを読み取り照合し、変更前の必要行/設定を暗号化保存・復号一致確認する。旧基準を上書きしない。今回作成するUUID、Stripe ID、期待件数と操作予約はGit管理外へ保存する。メール配送・OpenAI生成・本番接続・追加有料契約を含めない。Stripe Sandbox内のテスト通貨であり実カード請求は予定しない。既存無料環境の枠内が前提で、費用が必要なら停止する。

終了は成功/失敗/中断を問わず、まず新規操作を遮断してアプリ/CLI/中継を停止、今回の未終了契約のみ終了、開いた未決済Checkoutがあれば対象IDで期限切れにする。終了用の限定通信は新規作成を許可しない別の監督処理として残す。対象価格を無効化し、PortalのDB参照を元へ戻して新設定を無効化、一時資格情報を削除、今回のキーだけを失効する。各段階は独立記録し、1件でも未確認なら後片付け完了としない。

結果不明時は予約を保持して同じ変更を再送しない。既知IDのGET、Customer+Clock/runに限定した照合だけで到達状態を確認する。ID取得前の作成結果不明は、対象Clock+metadataの限定照合でも一意に特定できなければ停止する。アカウント全体のEvents/Customer検索へ拡張しない。API結果・DB反映・後片付けを別々に報告する。

Auth C/D、DBの契約/請求/監査、Stripeテスト取引を保持する。手動のDB行削除、Auth削除、Clock削除、返金は含めない。ただし**Test Clockのシミュレーションは公式仕様で作成30日後に自動削除される**。関連Customer等を永久保持できるとは扱わず、暗号化した照合記録を保持する。この自動削除の性質も次回承認対象に含める。既存A/B・購入・レポートはClockと無関係に維持する。

## 今回の検証結果と限界

結果は `plus-portal-local-results-20261020.json` を参照。ブラウザー16項目、17 migrationのRLS/利用枠、待機/正常終了/切断/上流失敗、OSの迂回拒否を検証した。生の運用記録・個人情報・実ID/秘密は本書へ取り込んでいない。

GitHub CIにポータブル回帰テストの実行ステップを追加した。CI結果は本変更のコミットに紐づくGitHub Actionsで確認し、基準CIの成功と今回の結果を区別する。Mac専用ブラウザー/OS試験はLinux CI項目ではない。外部33件、実RAK権限、実Test ClockとCheckout/Portalの組合せ、Stripe実画面/実配送、実Supabase本人JWT、本番公開の判定は未検証。
