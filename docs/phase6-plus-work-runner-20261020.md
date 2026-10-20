# Plus / Portal: Workによる実行と終了

以前の準備資料・完了試験・元manifestは保持する。この文書は実行接続と終了処理の追加仕様。実サービス試験・外部33件・公開可否の判定ではない。

## 起動

`scripts/phase6/subscription-runtime/run-approved.mjs` が専用の入口。旧subscription-live.test.tsは使わない。新しい所有者専用0700ディレクトリに、0600のplan.json・credentials.jsonと0700のevidenceディレクトリを置く。既存.env.localは使わない。

plan.jsonの固定キーはattemptId / manifest / expected / cli / clockApproval。manifestは既承認の対象・既存価格・保護対象・保持済み行・新C/Dを指定する構成入力であり、送信コマンドではない。expectedは元manifestと最新完了後の暗号化観測資料を復号・照合した値を用いる。現在値を取得して比較基準に採用してはいけない。旧基準・旧試行を上書きしない。cliは既存の固定バイナリとSHA256。clockApprovalは本人の5回承認の参照を必須とし、テストの合成承認を転用しない。

StripeカタログのactiveとDBの価格公開フラグは別に照合する。保持済みカタログがStripe価格active=trueの場合だけmanifest.stripePriceInitiallyActive=trueを指定する（省略時はfalse）。APIでその値を事前照合・暗号化保存し、準備時にも一致を確認する。既に有効なら有効化APIを送らず、対象DB行だけを承認範囲内で有効化する。終了時は元のカタログ状態にかかわらず、承認済みの終了方針どおりStripe・DBの対象価格を無効化する。現在値に合わせた基準変更や追加の無効化→再有効化は行わない。

credentials.jsonの固定フィールドはanon / service / listener / app / lifecycle / cPassword / dPassword / vaultKey。前2つは指定新DB専用の既存情報、Stripe3件は用途別制限付きキー、vaultKeyは32バイト鍵のbase64。これらをチャット・引数・ログへ記載しない。平文の一時入力は専用ディレクトリだけに置き、受渡し元を重複保存しない。暗号化記録を復号する鍵は本人の安全な保管先に保持する。

plan.jsonもCookie・セッション用情報を含み得る一時入力として扱う。開始時に暗号化と復号照合を行い、終了時はcredentials.jsonと独立して削除する。一方の削除失敗で他方を省略せず、削除未確認は完了としない。

既存のキー受信用フォームを使う場合、Workが先にbase-credentials.json（anon / service / cPassword / dPassword / vaultKeyのみ）を0600で準備する。入口は受信済みstripe-keys.jsonと結合し、credentials.jsonを上書きせず作成して読み返した後、元の2ファイルを削除する。標準キー・同一キーの使い回し・前回入力の上書きを拒否する。受信ページの内容や値をWorkのツール出力に取得しない。

exec_commandのtty=true / login=trueで `node scripts/phase6/subscription-runtime/run-approved.mjs <専用ディレクトリ>` を起動する。同じsession_idを最後まで使う。ready後にstatusを実行してアプリ・CLI・中継の生存を確認する。nextを1回ずつ送り、各段階の結果を待つ。10段階の後にfinish。通常の停止はstop。EOF・タイムアウト・プロセス異常・結果不明は停止し、別セッションから同じ試行を自動再開しない。

## Workへの連絡経路

operator-bridgeは同じ専用ディレクトリへrequest-N.jsonを出す。Workは期限内の要求を1回処理し、指定responseFileへ0600・原子的置換で `{id,ok,value}` を返す。これは承認の取り直しではなく、実行中プロセスとWorkの正式なツールを接続する経路である。制御TTYを閉じない。

- price: 指定価格のactiveだけを正式API/MCPで変更。プロセスは対象価格を別途読み取り照合する。Prices Writeを制限付きキーに追加しない。
- billing-read: 対象Sandboxの非秘密の請求設定を読み取る。account/livemode/source/observedAt/settingsを返す。開始時は対象外契約0・未回収請求0・稼働ルールなしの根拠も必要。設定8項目はbilling-settings.mjsのORIGINAL_BILLINGと一致すること。キー画面には移動しない。
- billing-write: 要求されたcardRetriesまたはexhaustedだけを変更する。再送禁止。保存後の別読み取りで確認する。APIがなければWorkが非秘密の設定画面を操作する。対象外への影響が不明ならok=falseで停止する。
- browser: 下表の非秘密の画面操作をWorkが実施する。本人のログイン・テスト支払い中は画面取得しない。確認結果は `{checkpoint,observed:true}` のみ。HTTP200を画面成功の代わりにせず、ブラウザーで必要な表示・遷移・拒否を確認する。記録にはoperator-observationと明示する。
- revoke-keys: サービス側で本人に限定される場合だけ本人が3件をまとめて失効する。確認後、プロセスが各キーで1回だけアカウント読取を試み、401とキー無効のコードを確認する。403やタイムアウトは失効済みとしない。

価格・設定・失効確認の要求は最大60秒。本人操作を含むbrowser要求は、同じ制御セッションの残り時間内で待つ（試験全体20分の上限は従来どおり）。期限超過・結果不明ならok=falseとし、変更を再送しない。期限切れの要求を後から実行してはいけない。試験全体の残り時間で終えられない場合、上限を暗黙に延長せず停止する。

## 固定順序

| next | Workと本人の境界 | 独立した確認 |
| --- | --- | --- |
| 1 logins | 専用C/Dのログインだけ本人。Workが診断一覧・利用枠表示を確認 | 実ログイン応答のJWTを親プロセス内に保持し/auth/userで本人ID確認、C/D/未認証RLS |
| 2 compatibility | WorkがCでプラン→同意→初回Checkout表示。作成は1回。準備用APIでPortal1を作り、同じCの別タブで表示・復帰。Checkoutはそのまま保持 | Customer/Clock/価格/未決済状態、互換性合格前の支払い禁止 |
| 3 first-paid | 本人が同じCheckoutでテスト支払い1回。Workがアカウントへの復帰を確認 | 契約1・請求1paid、配送済みcheckoutイベント、現在Plus30 |
| 4 renewal | Workが自動進行 | 期間末→draft、1時間後→paid（Clock累計2）。古い実受信イベントのローカル再投入を2回。未来期間は現在のPlusとしない |
| 5 failure | Workが失敗用PMへ切替1回、自動進行 | Clock累計4、請求3open、attempt_count=1、next_payment_attempt=null、past_due、現在free3 |
| 6 end-first | Workが元PMへ復帰1回、契約1を即時終了 | prorate=false/invoice_now=false、deleted配送・同期、現在free |
| 7 second-paid | WorkがCで再契約Checkout1回、本人支払い1回、復帰確認 | 契約2・請求累計4、未来期間の同期と現在freeを区別 |
| 8 portal-cancel | WorkがアカウントからPortal2へ遷移し再契約表示、期間末解約1回、復帰確認 | cancel_at_period_endと配送・同期。アプリから重ねて解約しない（中継でも拒否） |
| 9 end-second | Workが期間末へ進める | Clock累計5、canceled、請求累計4、現在free |
| 10 final | WorkがCの解約済み表示、Dのプラン操作拒否と空の契約表示、未認証拒否を確認 | C/D本人JWTによる無条件SELECTのRLS、未認証拒否、2契約4請求。本文・AI生成は行わない |

画面確認のためのアカウント更新はWebhook確認の後に行う。GET /api/billingにも同期処理があるため、それでWebhook配送成功を作ったことにしてはいけない。署名検証後に配送成功を捕捉したイベントと、DBの期間・状態・件数を別途照合する。ローカル再投入は実通知配送と区別して記録する。

## 終了

正常・失敗・中断すべてで、プロセス停止、送信中処理の収束、既知Checkout限定の照合・未決済終了、既知契約限定終了、価格OFF、DB価格OFF、Portal参照復元、新Portal設定OFF、一時入力削除、キー失効確認を行う。各独立処理は前項の失敗でも続ける。

設定復元前には、既知契約に限定して請求を読む。paid/void/uncollectible、またはopen/draftでauto_advance=falseかつnext_payment_attempt=nullのみ安全と判定する。件数・金額・所有Customer・Subscription・testモードも確認する。未知の作成物や結果不明が残る場合は安全確認済みとしない。追加の請求更新・回収・void・返金で解消しない。

安全な場合だけカード再試行ONとexhausted=cancelを独立して復元し、設定全体を再読取する。片方の失敗で他方を省略せず、未確認なら後片付け不成功。C/D・契約・請求・監査は保持する。保護対象と元基準は事後完全照合する。

## ローカル検証とCIの境界

connected.test.mjsは同じscenario/supervisorを実HTTP送信、暗号化記録、17マイグレーション適用済み隔離PostgreSQL/RLSへ接続する。正常・画面確認失敗・入力切断・請求安全確認失敗を検証する。既存provider-http.test.mjsで権限エラー、応答不明、タイムアウト、独立終了も検証する。

Linux CIではブラウザーを代替し、実送信先はloopbackのみ。MacではPLUS_CONNECTED_BROWSER=1で同じ処理を実Next/専用Chromeへ接続し、外部ネットワークをOSで禁止する。Stripe Checkout/Portal・Auth・請求エンジン・通知は合成であり、実サービスの成功とはしない。実TTY待機は別にPLUS_CONNECTED_TTY=1とNodeの--test-isolation=noneを使い、同一execセッションでstatus/next/finishを操作する。テスト実行器の子プロセスにTTYを置き換えさせない。実実行のrun-approved.mjsはテスト実行器を使わない。

キー受信フォームは `npm run test:subscription-key-form` で、別途、専用ブラウザーから合成値を実際に入力・送信する。実キー・利用者のブラウザープロファイル・画面取得は使わない。Linux CIでもこのフォーム検証はChromiumで実施し、契約シナリオ全体のブラウザー検証とは区別する。Macローカルではフォームのloopbackポート以外への通信をOSで禁止する。各ブラウザーのページ通信も対象originに限定する。

受信フォームのReferrer-Policyはsame-originとする。no-referrerではブラウザーがフォームPOSTのOriginをnullにし、正規送信も403になることを合成値で再現した。Originの一致必須・null/欠落の拒否・CSRF照合・保存先の排他作成は緩めない。HTTPクライアントがOriginを手動指定するテストだけでは、この不具合は検出できない。拒否を実キーで繰り返さず、受信状況を確認して安全停止し、一時入力を削除する。同じ試行を別セッションから自動再開しない。
