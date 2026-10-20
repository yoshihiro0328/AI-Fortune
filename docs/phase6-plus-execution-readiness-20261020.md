# Plus / Portal 発行前の実行設計

## 今回の境界と結論

今回はローカル実装・模擬HTTP・隔離DB・レビュー・CIまで。実キー発行、Stripe/Supabase接続、既存データ変更、ログイン、購入は実施しない。STEP 10とr5の単発購入・ready本文・A/Bを保持する。旧準備資料は履歴として保持し、本書が次回案の差分を定義する。

推奨順序は、権限と請求設定の発行前確認 → 差分承認 → 3用途のキー受渡し → 対象限定の事前照合 → Clock/Customer/PortalとC/D準備 → **未決済CheckoutとPortalの互換性確認** → 同じCheckoutで初回支払い → 更新成功/失敗 → 終了 → 再契約/期間末終了 → 後片付け。互換性未確認のまま契約全工程を開始しない。

## APIと権限の対応

[制限付きキーの公式資料](https://docs.stripe.com/keys/restricted-api-keys)はGETにRead、POST/DELETEにWrite、WriteにはReadを含むと説明する。これはAPI一般の根拠であり、各APIの非公開の依存権限まで証明しない。Stripe Apps用permission名をRAKへ転記しない。標準キーが必要とは判定していない。

R=読み取り、W=書き込み。全キーは新Sandbox `acct_1UQlQdI73kTcvXz8` 限定、最大3件。他の項目は「なし」。価格のStripe側変更は本人Dashboard操作で、Prices Writeを追加しない。

| API / 用途 | 用途別キー・権限 | 根拠と未確認範囲 |
| --- | --- | --- |
| GET /v1/account | 全3キー Accounts R | API方式は公式。Accountを実応答で照合してから先へ進む |
| GET /v1/prices/{指定ID} | アプリ・準備 Prices R | 月額980 JPY・test・対象Product・activeを検査 |
| GET /v1/customers/{新ID} | アプリ Customers R、準備 Customers W | Clock・run・C本人のbindingを確認 |
| POST /v1/customers | 準備 Customers W | Clock1件への新規1件のみ。emailや実住所を渡さない |
| POST /v1/checkout/sessions、POST /{ID}/expire、GET /{ID} | アプリ Checkout Sessions W | 作成2・未決済終了2まで。CLIは同リソースRのみ |
| GET /v1/subscriptions/{ID}、Customerで限定した一覧 | アプリ・準備 Subscriptions W（R包含） | 取得した新Subscription最大2件以外を扱わない |
| POST /v1/subscriptions/{ID} cancel_at_period_end | アプリ Subscriptions W | 本文はこの項目trueのみ。各契約1回まで |
| POST /v1/subscriptions/{ID} default_payment_method | 準備 Subscriptions W | 失敗用1回・元の方法へ復帰1回 |
| DELETE /v1/subscriptions/{ID} | 準備 Subscriptions W | invoice_now=false、prorate=false。初回終了1回、中断時は未終了対象最大2件。結果不明の同操作を再送しない |
| GET /v1/invoices?subscription={対象ID}&limit=5 | アプリ Invoices R | 対象以外・has_more・4件超・追加支払い試行は停止。全アカウント検索なし |
| POST /v1/test_helpers/test_clocks、POST /{ID}/advance、GET /{ID} | 準備 Test Clocks W | 公式Clock API + 本人の権限行確認。実RAKでの許可結果は未確認 |
| POST /v1/payment_methods/pm_card_chargeCustomerFail/attach | 準備 Payment Methods W | 公式の失敗テスト用alias。実カード/SetupIntent/PaymentIntents Writeは使用しない。実RAKの追加依存は未確認 |
| POST /v1/billing_portal/configurations、GET /{ID}、POST /{ID} active=false | 準備 Customer Portal W | 本人確認ではSession/Configuration別の行ではなくCustomer Portalの1行 |
| POST /v1/billing_portal/sessions | **準備 Customer Portal W**を中継が使用 | アプリ用キーからPortal権限を除く。中継の許可は新Customer・新Config・localhost復帰・Session合算2件のみ |
| CLI listen（6イベント、@self）、必要なイベント読取 | 受信用 Accounts/Events/Checkout Sessions R + Debugging Tools W | 前段のCLI経験・公式CLI資料。Debugging Tools権限そのものが6イベントだけに限定される意味ではない。今回の固定CLI/API版で実listenは未検証 |

Supabaseは新DB `ukdzggjfkcwjssjmnqim` だけ。管理者確認済みC/D作成2件は既存の専用service資格情報で行う。その他は価格1行・Portal参照1行・Cのbilling binding1行と、承認済み認証/RPC/通知に必要な更新だけ。A/Bのデータをfixture扱いしない。

### 本人の発行前画面確認（API成功とは区別）

本人申告で、Test Clocks / Customer Portal / Payment Methodsに「なし・読み取り・書き込み」があり、それぞれ書き込みを選んでも他の行の自動変更はなかった。画面・AX・スクリーンショットは取得していない。**キーを作成せず画面を閉じた**。これによりDashboardの候補権限は具体化できたが、隠れたAPI依存や実通信の成功までは確認していない。

次回は本人が対象Sandbox・上記の3用途別設定を照合して発行する。秘密値画面・パスワード画面・入力中画面・クリップボードをWorkが取得しない。本人だけが保管・専用入力・失効を実施する。Account等の許可内読取で403が出たら停止し、権限を増やさない。書込権限の完全な事前証明を狙った余分な作成試験は行わない。

## 時系列とClock上限の変更案

[Clockの公式手順](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage)では更新境界のdraft請求を、その後1時間進めて確定・支払いする例が示される。したがって3回で全工程が終わる根拠はない。**5回を提案するが、現時点の実行上限は3回のまま**。コードは既定3回、別途明示承認の参照を渡した場合のみ5回を許容する。ローカル試験の承認参照は合成値であり、実承認として再利用しない。

| 段階 | 操作と期待状態 | Clock累計 | Invoice累計上限 | 権限 |
| --- | --- | ---: | ---: | --- |
| 準備 | Clock1・Customer1・Portal設定1、C/D2、価格ON。Clock readyを確認 | 0 | 0 | 準備キー各W、本人価格操作 |
| 最小互換性 | 初回Checkout1作成・実ページ表示（まだ支払わない）、Portal Session1作成・表示・localhost復帰 | 0 | 0 | Checkout W、Customer Portal W |
| 初回 | **同じCheckout**で本人テスト支払い1回、初回契約・請求1 paid、現在期間のPlus反映 | 0 | 1 | 本人操作、署名通知、R |
| 更新境界 | 取得した初回契約のperiod_endまでadvance。請求2 draft | 1 | 2 | Test Clocks W、Invoices R |
| 更新確定 | 1時間進める。請求2 paidを照合。未来期間の同期として判定 | 2 | 2 | 同上 |
| 失敗準備 | 公式失敗用PMをCustomerへattach1回、初回Subscriptionへ設定1回 | 2 | 2 | Payment Methods W、Subscriptions W |
| 次の境界 | 次のperiod_endまでadvance。請求3 draft | 3 | 3 | Clock W、Invoices R |
| 失敗確定 | 1時間進める。請求3 open / payment_failed、attempt_countが1を超えないことを確認 | 4（変更案） | 3 | 同上 |
| 復帰・終了 | 元PMへ復帰1回→Clockを進めず初回契約を即時終了。再試行増加があれば停止 | 4 | 3 | Subscriptions W |
| 再契約 | Checkout2、本人支払い2回目。請求4 paid。Portal Session2で契約表示・期間末解約・localhost復帰 | 4 | 4 | Checkout W、Portal W、署名通知 |
| 期間末 | 再契約period_endまでadvanceしcanceled確認。請求5は許容しない | 5（変更案） | 4 | Clock W、対象契約/請求R |
| 終了 | 未終了契約・未決済Checkoutの限定終了、価格OFF、Portal参照復元/新Config無効化、プロセス停止、一時情報削除、キー失効 | 増やさない | 増やさない | 上表の終了権限 |

暗号化鍵は一時入力ファイルとは別の承認済み保管先に保持し、終了後もバックアップを復号できる状態にする。公開記録に鍵を含めない。

再契約の期間末解約はPortal内で1回だけ行い、アプリ解約APIで同じ操作を重ねない。

各advanceは直前readyを要求し、各32日以内。要求後のready照合は最大12回/60秒。確定が1時間で終わらなければ停止し、6回目のadvance、請求確定API、再支払いを追加しない。試験本体の制御待機は既定20分、HTTP各15秒。本人の価格操作確認は各60秒で未確認として停止し、終了処理と本人のキー失効確認は別結果として記録する。請求4件・固有通知40件/同一ID3回の上限を維持する。**受信停止上限はStripe側での自動生成を抑える設定ではない**。

発行前に本人が請求確定猶予・自動再請求/通知設定を読み取り確認する必要がある。現在値は未取得。設定変更を前提にせず、予定内の確定/試行数を保証できない場合は開始しない。公式資料だけでSandboxの実設定を断定しない。テスト上は成功980×3＝2940 JPYと失敗980×1を予定し、実金銭・追加料金は0円の範囲。支払い試行は本人2回とClockによる更新成功/失敗各1回で区別する。

## Clock付きCustomerとCheckout / Portalの最小互換性確認

[Checkout作成](https://docs.stripe.com/api/checkout/sessions/create)は既存Customerとsubscription mode、[Portal作成](https://docs.stripe.com/api/customer_portal/sessions/create)はCustomer・Configuration・return_urlを受け付ける。ただし今回のHosted Checkout/PortalとTest Clockの組合せを資料だけで保証できなかった。非対応とも成功とも扱わない。

新規オブジェクトを増やさず上表のClock1/Customer1/Config1、初回Checkout1、Portal Session1を使用する。中継の準備用処理が新CustomerのPortal Sessionを作成し、本人がページ表示と復帰を確認する。未契約時のPortal表示成功は、契約後の管理操作成功とは別で、後者はSession2で確認する。APIの200だけで画面互換性を成功にしない。Portalで支払い情報を追加・変更しない。

両ページが表示でき、復帰先・対象環境・980 JPYが正しい場合に限り、**既に作ったCheckout**で初回支払いへ続ける。不成立なら支払わず停止。対象のopen Checkoutをexpire、価格OFF、参照復元・Config無効化・プロセス停止・一時情報削除・本人キー失効を実施する。C/D・Customer・Clock・監査記録は保持（ClockのStripe側自動削除の留保あり）。失敗した作成の再送、別Customer、追加Portal Sessionは作らない。

## 実装と検証範囲

| 部品 | 今回の状態 | 実環境に残る確認 |
| --- | --- | --- |
| provider-entry.mjs | 既存安全入力からの専用入口。CLIハッシュを外部要求前に照合、同一TTYのsupervisorへ接続。不正入力時も一時ファイル削除。importだけでは接続しない | 本人の受渡し・既存CLIの実ハッシュ |
| wire.mjs | Stripe form / Supabase JSONの実HTTP sender、固定host・固定API版・RAK限定・15秒・redirect/retry禁止、進行中要求のsettle | 実RAK/API受理、TLS/外部応答 |
| provider-ops.mjs | 新C/D/Clock/Customer/Config準備、既存比較資料と照合、CASで対象価格/参照変更、対象Checkout/Subscription binding、Clock/PM/解約/請求照合、対象限定終了 | 実設定・公式サービスとの互換性 |
| app-transport.mjs | broker検査後だけ送信。Portalを準備キーに振り分け、アプリと互換性確認でPortal総数を共有 | 実HTTP/署名配送 |
| supervisor.mjs / launch.mjs | 同一TTY、ready/status、失敗/切断/中断/時間上限で新規操作停止。送信処理が停止した後に終了操作。価格・Portal・キーの本人操作は明示したコールバック | 実CLI生存、実本人操作・失効確認 |
| vault.mjs | 0700/0600、AES-256-GCM、wx新規作成、fsync、復号一致。旧基準/試行を上書きしない | 既存保護資料の受渡しと新しい観測値 |
| provider-http.test.mjs | 上記と同じsenderをloopback HTTPへ接続。17 migrationを適用したPGliteで実列・CAS・保持行を照合。正常、403、切断、timeout、中断、終了失敗、設定差分、3回上限、5回提案を確認 | 実請求エンジン・実時計・実Stripe UIの保証にはならない |
| 既存ブラウザー/OS隔離試験 | 前段のNext→画面→模擬Stripe/Portal→復帰、C/D/未認証、RLS、OS通信拒否の結果を維持 | Linux CIと区別。今回のAPI sender試験だけで実画面成功を追加計上しない |

準備用操作も送信前に暗号化予約記録を作り、結果不明は停止。対象IDが分からない新規作成はアカウント全体検索や再作成を行わず、未確認の残存候補として報告する。対象が分かるCheckoutは終了時に再読取し、直前の支払いで成立したSubscriptionも照合して終了対象へ含める。1リソースの終了失敗で他の既知リソースの終了を省略しない。未知差分を以前の基準へ上書きしない。

C/D・契約/請求/監査・bindingは保持。価格とPortal参照の更新日時は許可した変更に伴う差分として暗号化記録に残し、設定内容の復元と区別する。失敗・結果不明が残ると処理全体は非0・未完了になる。保護対象A/Bプロフィール・契約、r5の診断/回答/無料レポート/購入/有料本文は完全一致を要求する。新規の認証/利用制限記録は付随更新として別に扱う。

## 次回の一括承認で必要な差分

1. Clock更新上限を3→5へ。請求4・本人支払い2・契約2・Portal2・通知上限は変更しない。
2. Customer Portal Wを準備/終了用キーへ集約。アプリキーにはPortal権限なし。準備キーのPortal権限がConfigurationだけに分離されないことを明記する。新しい権限リソースは加えない。
3. 初回支払い前に同じClock/CustomerでCheckout表示とPortal Session1の表示/復帰を確認し、合格時だけ同じCheckoutで続行。互換性用に件数は増やさない。
4. 本人の読取確認で請求確定猶予・自動再試行が予定内であることを確認する。未確定/不足権限・料金・上限超過・対象違いならキー/購入を開始せず、実行途中なら限定終了処理を行う。サポート回答待ちは必須条件にしない。

キー発行・外部試験の再開は今回実施しない。外部33件は未実行のまま。本番公開可否には読み替えない。
