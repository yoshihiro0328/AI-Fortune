# 月額Plus / Portal：発行前レビュー

対象は新Sandbox `acct_1UQlQdI73kTcvXz8`、新DB `ukdzggjfkcwjssjmnqim`、localhost:5218だけ。条件付きの実行承認を受けたが、以下の未確定事項が残るため、今回はキー発行・外部設定・Auth/DB変更・Stripe試験を開始しない。標準キーが必要だと判定したわけではない。STEP 10と単発試験の完了状態は維持する。

## 公開資料から確認できたこと

- [制限付きキーの公式資料](https://docs.stripe.com/keys/restricted-api-keys)は全APIでRAKが利用可能と説明し、GETはRead、POST/DELETEはWrite、WriteにはReadを含むとしている。ただし今回の各エンドポイントのDashboard権限ラベル・依存権限一覧を網羅していない。資料にある「失敗後に権限追加」「広く付けてから削減」は今回の承認条件では採用しない。
- [Test Clockの公式資料](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage)はCustomerとの紐付け、時間の前進、ready確認、対象SubscriptionでのInvoice絞込み、30日後の自動削除を説明する。今回の1 Customer / 2 Subscriptionは資料上の個数上限内。Clock自動削除は保持方針の留保として承認済み。
- 同資料の更新例は、期間更新時のdraft請求について、その後1時間進めて確定・支払いを確認する手順を示す。したがって「更新成功→失敗→再契約終了」の全工程が必ずadvance 3回で済むとは確定しない。回数を追加したり請求確定APIを追加する判断はしない。
- [契約通知](https://docs.stripe.com/billing/subscriptions/webhooks)と[Portal統合](https://docs.stripe.com/customer-management/integrate-customer-portal)の一般的な動作は確認できる。Clock付きCustomerで今回の実Checkout初回・再契約と実Portalを通す組合せの保証までは確認できなかった。非対応と断定もしない。

## 発行前に残る確認

| 項目 | 必要な確認 / 現在の判断 |
| --- | --- |
| アプリRAK | Customer Portal Session Write / Configuration Readの分離と依存権限。その他は実行案のAccounts/Prices/Customers/Invoices Read、Checkout Sessions Write、Subscriptions Writeの上限を維持 |
| 準備・Clock用RAK | Test Clocks作成/advance、Payment Methodsの失敗用設定、Portal Configuration作成/無効化に対応する正確なRAK権限と依存関係が未確定 |
| CLI用RAK | Accounts/Events/Checkout Sessions Read + Debugging Tools Writeは前段の経験を踏まえた上限。今回API版・6イベントの実listenは未実施 |
| 終了権限 | Subscription終了はSubscriptions Write。未決済Checkoutのexpireはアプリ用Checkout Sessions Writeを利用する設計で、Clock用キーへ追加しない。Portal設定無効化はその作成用キー。価格は本人Dashboard操作。実RAK依存は上記と同じく未確定 |
| 請求・通知 | 請求は2契約合算4件、固有受信イベント40・同一ID3回、6イベント購読を維持。これは中継の停止上限であり、Stripe側の生成件数を強制する設定ではない。対象Sandboxの自動再請求/請求確定条件は未読取で、追加支払い試行がないとは未確認 |
| Clock更新3回 | 請求確定待ちを含む進行時刻と、実Checkout/Portalとの組合せを確定できていない。未確定のままCustomer/Clockを作成しない |

次の判断に必要なのは、秘密値のない権限ラベル・依存関係についての公式回答または本人の発行前画面確認と、Clock/Checkout/Portalおよび請求確定を含む3回以内の進行条件の根拠。問い合わせ送信・追加権限・追加Clock更新は今回実施していない。現在の上限に収まると確定できれば既承認範囲を使用し、収まらなければ差分をまとめて提示する。

## レビュー修正

- Invoiceの上限を各Subscriptionごとではなく、試行全体の固有Invoice ID合算4件に変更。再読取は重複加算せず、返却Invoiceが要求したSubscriptionに属することも確認。
- Clockのadvanceは送信前に時刻を予約。確認時は同じClock、test環境、要求した時刻、readyのすべてを要求し、別時刻の確認では通信しない。
- 起動前に固定API版を要求。未指定同士の一致でlistener確認を通過させない。
- ローカルの未来権限境界ケースは5件目の請求を追加せず、Subscription期間変更の合成通知として独立確認。通常シナリオは実行案と同じ請求4件。
- CIへPlusのポータブル回帰テストを追加。実Chrome / MacのOS隔離はローカル検証として分離。

実ネットワーク用のキー取得・provisioning・終了用アダプターは、権限確定後に対象操作へ束縛して最終確認する必要がある。現在のローカル部品・模擬アダプター成功を、実環境の起動・後片付け成功と読み替えない。外部33件の検証状態は変更していない。
