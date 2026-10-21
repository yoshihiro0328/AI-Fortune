# 月額Plus最小実試験（2026-10-21承認範囲）

**最新指示：縮小試験の継続は承認済み。** 標準キー対応は本人申告の記録で区切り、追加調査・置換キー使用をしない。Workによるキー一覧・作成・詳細画面とDOM/AX/ボタン名/ツールチップ/スクリーンショット/クリップボードの取得は禁止を維持する。新規キーはまだ作成していない。下記の終了待機時間の差分は未承認で、実起動入口は承認記録なしでは実行できない。[標準キー対応記録](phase6-key-exposure-review-20261021.md)。

対象はSandbox `acct_1UQlQdI73kTcvXz8` / Supabase `ukdzggjfkcwjssjmnqim` / localhost:5218のみ。既存A/B、単発購入、本文、STEP 10は維持。実金銭・有料化・AI生成・マージ・デプロイなし。旧拡大シナリオ、外部33件一括実行はしない。

## 固定範囲と送信上限

- 管理者確認済み・メール送信なしの新C/D各1名（本人認証配送試験とはしない）。専用Customer1件。既存ユーザーの流用なし。
- Checkout1件・テスト支払い1回・Subscription1件・Invoice1件。支払い結果不明時に購入し直さない。
- Portal設定1件・Portal Session1件。表示と復帰のみ。subscription_update/customer_update/subscription_cancel/payment_method_updateを無効、invoice_historyのみ有効。
- その契約だけを即時解約1回。DELETEに `invoice_now=false, prorate=false` を固定。請求1件paidを前後確認。返金・最終請求・日割り調整なし。
- Clock0件/更新0回、支払方法切替0回、意図的失敗0回、再契約0件、通知のローカル再投入0回、Smart Retries変更0回。旧経路の機能をキー権限と送信ガード両方から除外する。
- 未決済Checkoutの終了は既知ID1件のみ。正常終了済み契約には再度DELETEしない。結果不明は限定GETで照合し、書き込み再送なし。
- ログインC/D各1回、各更新最大2回。元の通信数・通知数・20分実行枠・秘密受領後2時間を拡張しない。終了時の本人操作待ちだけは下記の差分承認待ち。

## 3用途キーの必要権限（すべて制限付き・test）

3用途はCLI受信・アプリ・準備終了の分離に必要なので維持する。今回の名前は新しい試行IDの先頭8字を含める。これまでの失効済みキーは再利用しない。

| 用途 | Read | Write | 外したもの |
| --- | --- | --- | --- |
| listener | Accounts, Events, Checkout Sessions | Debugging Tools | 追加なし。実通知受信に必要なCLI接続を維持 |
| app | Accounts, Prices, Customers, Subscriptions, Invoices | Checkout Sessions | Subscriptions WriteをReadへ削減。Portalなし |
| lifecycle | Accounts, Prices | Customers, Subscriptions, Customer Portal | Test Clocks、Payment Methodsを完全に除去。Prices Writeなし |

GET/POST/DELETEは既知対象に限定。Portalの権限は準備終了キーで中継し、アプリキーへ付与しない。CLI接続はWebhook署名秘密の安全な取得に必要であり、MCP接続で代替したと推測しない。Accountsによる対象照合・失効読取、CLIの既存イベントフィルターは維持。隠れた追加依存が実際に要求されたら購入前に停止し、権限を追加しない。

## 実行経路

plan.manifest.scenario=`minimal-plus-v1`、stripePriceInitiallyActive=true、clockApproval=null。新規専用ディレクトリと受渡しフォーム、旧基準との照合を使用。開始前の十分な残り時間、暗号化と復号確認を維持。キー画面の取得禁止により、キー作成・保存・専用フォーム送信・終了時失効は本人が担当する。Workは画面を取得せず、本人操作を必要なタイミングで1操作ずつ案内する。フォーム未入力待ちと試験時間は分離する。

| 段階 | 画面・操作 | 独立した確認 |
| --- | --- | --- |
| 準備 | 新C/D・Customer・表示専用Portal、DB価格のみ一時公開 | 元manifest・最新記録・Stripe価格との一致、保護対象暗号化、追加課金設定なし |
| logins | C/Dログイン、診断一覧 | 本人JWTの/auth/userとRLS、空の契約/請求 |
| checkout-display | Cプラン→同意→同じCheckout表示 | 金額980JPY、専用Customer、未決済・契約未作成 |
| first-paid | テスト支払い1回、アカウントへ復帰 | 実署名通知成功、契約active・請求1件paid、DB同期・現在Plus30、C/D/未認証RLS |
| portal-display | Plusと契約表示、Portal表示・復帰 | Session合計1件、C契約/請求のRLS |
| end-minimal | Workが即時解約 | 実deleted通知、canceled、請求1件paid維持、現在Free3 |
| final-minimal | C解約済み表示、D/未認証の拒否 | C/D本人JWT無条件SELECT、D/未認証から契約/請求不可 |

アカウントGETにも同期機能があるため、画面の成功だけでWebhook成功とはしない。署名検証・成功配送を別に捕捉し、DB状態と照合する。利用枠だけを確認しAI相談は生成しない。

## 価格と終了

Stripe価格 `price_1UQlpjI73kTcvXz814TUAfOd` の試験前active=trueと商品 `prod_VRfAjqXSjem3nl` の既定価格参照を維持。価格・商品への書き込みなし。準備/終了でStripe価格を暗号化し一致を確認する。既定価格参照は既存MCPによる読み取りで確認し、RAKにProducts権限を追加しない。DBの `plus-integration-202610-980-v1` だけactive=false→true→false。Stripe全経路で購入不可とは扱わない。

終了は正常・失敗・中断共通。専用プロセス停止、既知Checkout/契約の限定照合と終了、請求安全確認、Stripeカタログ維持確認、DB価格非公開、Portal参照復元・新設定無効化、保護対象の最終照合、キー失効確認、一時資格情報削除。**資格情報を使う照合は失効より前**。独立した終了処理は一部失敗でも続ける。従来の終了60秒枠はキー失効最大40秒・並行GET最大15秒・削除5秒で、本人による3件の操作待ちと合わない。未承認差分案：本人の失効操作待ちだけ最大5分（40秒から変更）、各キー1回の並行GET最大15秒、削除用5秒を確保する。秘密の絶対期限が近い場合は待機を短縮し、延長しない。期限切れでも削除を実施し未確認を明記する。

C/D・Customer・契約・請求・監査記録は保持。結果不明の作成物は再作成せず未解決として残す。削除や請求更新で帳尻を合わせない。今回の前提は既存の再試行復元確認記録（ON/Smart/2週間/最大8回/終了後cancel）であり、設定の切替は一切行わない。

## 検証の区別

同じ送信処理を模擬HTTP・隔離DBに接続し、正常、権限拒否、結果不明、画面失敗、途中切断、請求不整合、独立終了を検証する。Linux CIとMac専用ブラウザー/OS隔離は区別する。ブラウザーは実Nextアプリのログイン→プラン→決済代替→契約表示→Portal代替→復帰→解約後表示を通す。Stripe・Auth・通知は合成で、実サービス検証済みとしない。実試験完了後もClock、更新成功/失敗、再契約、期間末解約、未来期間同期は未完了として残す。

根拠：[即時解約と請求](https://docs.stripe.com/billing/subscriptions/cancel)、[新規契約の請求確定](https://docs.stripe.com/billing/invoices/subscription)、[管理者によるユーザー作成](https://supabase.com/docs/reference/javascript/auth-admin-createuser)。追加費用なしのSandboxテストを前提とし、有料化要求時は停止する。

## 今回の接続修正と差分承認待ち

- 専用C/Dのログインは、localhostの試験専用通信中継に公開の操作用文字列 `UsePreparedTestAccount123!` を入力する。これは実パスワードではない。既存の本人・送信先・回数ポリシーを通した後、親プロセスが今回生成したC/DのパスワードをAuthのpassword grantへ送る。各ユーザー1回、送信前に消費し結果不明の再送を拒否する。既存ユーザー、通常アプリ、他の認証経路に適用しない。実際のAuth応答の本人JWTでRLSを確認し、管理者JWTや合成セッションで代用しない。通常のパスワード手入力自体の実試験とは区別する。
- planの固定項目へ `ownerKeyClosure` を追加する。承認後だけ `{approved:true, waitMs:300000, reference:"owner-key-wait-5min"}` を記録する。現在この差分は未承認であり、テスト内の合成承認を実行用に転用しない。
- 終了時は照合・復元・専用プロセス停止の後、本人の3キー失効を順に案内する。成功・失敗・中断のどれでも、失効API確認の成否と一時資格情報削除を別々に残す。本人操作やAPI確認が時間切れでも削除を続ける。
- 承認対象は上記の本人失効待ち40秒→最大5分だけ。再試行設定、購入・契約・請求件数、キー権限、試験20分、秘密受領後2時間、外部操作範囲は変更しない。

### 今回の修正検証

- 既存成功HEAD `52f25b6d1ed01c94ac62258c2cec2dcd1814f1da` / CI `39564398459` の検証記録を再利用。変更のある認証受渡しと終了待機、および接続先の回帰だけを追加検証。
- 合成HTTP・隔離DBのsubscription-scripts：137/137成功。正常・失敗・結果不明・中断・独立終了、本人操作待ちの上限・絶対期限・期限後削除を確認。
- Macの外部通信遮断ブラウザーで縮小シナリオ1件成功（C/D操作用文字列→親の専用パスワード→Auth応答→画面→契約→Portal→解約→終了）。実Auth/Stripeは代替で、実サービス成功の証拠にはしない。
- 差分レビュー：資格情報の保管期限を延長しないこと、結果不明の認証再送をしないこと、失効確認より先に資格情報を削除しないこと、未承認の待機拡張では実起動できないことを確認。通常アプリコード・既存A/B・本文・STEP 10は変更していない。
- 実試験、新規キー作成、Stripe/DBの外部変更はこの準備では0件。新しい一時資格情報なし。ローカル検証用プロセスは終了済み。
