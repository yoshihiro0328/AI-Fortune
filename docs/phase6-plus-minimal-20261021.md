# 月額Plus最小実試験（2026-10-21承認範囲）

対象はSandbox `acct_1UQlQdI73kTcvXz8` / Supabase `ukdzggjfkcwjssjmnqim` / localhost:5218のみ。既存A/B、単発購入、本文、STEP 10は維持。実金銭・有料化・AI生成・マージ・デプロイなし。旧拡大シナリオ、外部33件一括実行はしない。

## 固定範囲と送信上限

- 管理者確認済み・メール送信なしの新C/D各1名（本人認証配送試験とはしない）。専用Customer1件。既存ユーザーの流用なし。
- Checkout1件・テスト支払い1回・Subscription1件・Invoice1件。支払い結果不明時に購入し直さない。
- Portal設定1件・Portal Session1件。表示と復帰のみ。subscription_update/customer_update/subscription_cancel/payment_method_updateを無効、invoice_historyのみ有効。
- その契約だけを即時解約1回。DELETEに `invoice_now=false, prorate=false` を固定。請求1件paidを前後確認。返金・最終請求・日割り調整なし。
- Clock0件/更新0回、支払方法切替0回、意図的失敗0回、再契約0件、通知のローカル再投入0回、Smart Retries変更0回。旧経路の機能をキー権限と送信ガード両方から除外する。
- 未決済Checkoutの終了は既知ID1件のみ。正常終了済み契約には再度DELETEしない。結果不明は限定GETで照合し、書き込み再送なし。
- ログインC/D各1回、各更新最大2回。元の通信数・通知数・20分実行枠・秘密受領後2時間・終了60秒枠を拡張しない。

## 3用途キーの必要権限（すべて制限付き・test）

3用途はCLI受信・アプリ・準備終了の分離に必要なので維持する。今回の名前は新しい試行IDの先頭8字を含める。これまでの失効済みキーは再利用しない。

| 用途 | Read | Write | 外したもの |
| --- | --- | --- | --- |
| listener | Accounts, Events, Checkout Sessions | Debugging Tools | 追加なし。実通知受信に必要なCLI接続を維持 |
| app | Accounts, Prices, Customers, Subscriptions, Invoices | Checkout Sessions | Subscriptions WriteをReadへ削減。Portalなし |
| lifecycle | Accounts, Prices | Customers, Subscriptions, Customer Portal | Test Clocks、Payment Methodsを完全に除去。Prices Writeなし |

GET/POST/DELETEは既知対象に限定。Portalの権限は準備終了キーで中継し、アプリキーへ付与しない。CLI接続はWebhook署名秘密の安全な取得に必要であり、MCP接続で代替したと推測しない。Accountsによる対象照合・失効読取、CLIの既存イベントフィルターは維持。隠れた追加依存が実際に要求されたら購入前に停止し、権限を追加しない。

## 実行経路

plan.manifest.scenario=`minimal-plus-v1`、stripePriceInitiallyActive=true、clockApproval=null。新規専用ディレクトリと受渡しフォーム、旧基準との照合を使用。開始前の十分な残り時間、暗号化と復号確認を維持。キー作成はWork、生成後の秘密値保存・フォーム送信は本人。作成後の画面/AX/スクリーンショット/クリップボード取得禁止。フォーム未入力待ちと試験時間は分離する。

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

終了は正常・失敗・中断共通。専用プロセス停止、既知Checkout/契約の限定照合と終了、請求安全確認、Stripeカタログ維持確認、DB価格非公開、Portal参照復元・新設定無効化、保護対象の最終照合、キー失効確認、一時資格情報削除。**資格情報を使う照合は失効より前**。独立した終了処理は一部失敗でも続ける。60秒枠内でキー失効最大40秒、各キー1回の並行GET最大15秒、残りを削除に確保する。期限切れでも削除を実施し未確認を明記する。

C/D・Customer・契約・請求・監査記録は保持。結果不明の作成物は再作成せず未解決として残す。削除や請求更新で帳尻を合わせない。今回の前提は既存の再試行復元確認記録（ON/Smart/2週間/最大8回/終了後cancel）であり、設定の切替は一切行わない。

## 検証の区別

同じ送信処理を模擬HTTP・隔離DBに接続し、正常、権限拒否、結果不明、画面失敗、途中切断、請求不整合、独立終了を検証する。Linux CIとMac専用ブラウザー/OS隔離は区別する。ブラウザーは実Nextアプリのログイン→プラン→決済代替→契約表示→Portal代替→復帰→解約後表示を通す。Stripe・Auth・通知は合成で、実サービス検証済みとしない。実試験完了後もClock、更新成功/失敗、再契約、期間末解約、未来期間同期は未完了として残す。

根拠：[即時解約と請求](https://docs.stripe.com/billing/subscriptions/cancel)、[新規契約の請求確定](https://docs.stripe.com/billing/invoices/subscription)、[管理者によるユーザー作成](https://supabase.com/docs/reference/javascript/auth-admin-createuser)。追加費用なしのSandboxテストを前提とし、有料化要求時は停止する。
