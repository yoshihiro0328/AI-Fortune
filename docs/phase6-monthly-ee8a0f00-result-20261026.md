# 月額残試験 ee8a0f00 の実測・終了記録

対象は承認済みSandbox `acct_1UQlQdI73kTcvXz8` とDB `ukdzggjfkcwjssjmnqim`。実施日は2026-10-26（日本時間）。A/B一括承認の上限はリセットしない。既存の成功結果は保持し、今回の初回支払いを更新成功へ読み替えない。

## 実測結果

| 工程 | 結果 |
| --- | --- |
| E準備 | 専用Auth/profile、Customer、紐付け、Clock、契約を各1件作成。Fは未作成 |
| 初回支払い | Sandbox 980 JPYを1回。請求paid・残額0 |
| 実通知 | customer.subscription.created、invoice.paidを署名検証してHTTP 200。invoice.paidと処理済みDB行・同一契約・請求1件を照合 |
| 権限 | 初回請求の期間終了が実現在時刻より前なのでFree。現在PlusやPlus→Freeの成功ではない |
| Clock前進 | POSTはHTTP 200。応答検査で停止。後の限定GETでready、要求時刻への前進完了を確認。POST再送なし |
| 更新 | 980円のdraft請求が1件生成。支払済み更新・paid_through延長は未実証 |
| 期間末解約・実削除通知の解除 | 未実施・未実証 |
| Fの支払い失敗・再試行終了 | 未実施 |
| 実AI | 計数API課金条件未確認という承認計画の停止条件を維持。計数0、生成0、モデル利用料推計0 USD。請求明細で確定した金額ではない。品質サンプルなし |

今回の実消費は成功支払い1/3、失敗0/9、Clock前進1/16。Eの契約1件は解約済みなので、その契約を更新試験に再利用できない。残枠を新しい試行として復活させない。

## 原因と修正

公式の[Clock前進API](https://docs.stripe.com/api/test_clocks/advance)は、成功時にstatus=advancingを返し、readyで完了すると説明している。公式応答例のfrozen_timeは要求した次の時刻ではなく前の時刻である。実装と合成fixtureは、POST成功時点で新時刻を要求していた。

実記録で確定しているのはPOST 200、直後の応答検査失敗、後続GETでready・目標時刻、直後の解約要求429である。POST応答本文および429の詳細本文は保存していないため、応答内のどのフィールドが不一致だったかと、429のStripe側の詳細分類は未確定。公式仕様と矛盾する時刻検査は今回の停止経路に存在する実装不具合として修正した。

修正は、advancing中の前時刻または目標時刻を認め、readyになったときだけ目標時刻への一致を要求するもの。別Clock・本番mode・未知status・readyの時刻不一致は拒否する。前進POSTの再送は追加しない。解約前にも既存60秒枠の中でClock readyを最大30秒だけ読み取り待機し、ready未確認では解約を送らない。残り15秒以上を解約用に確保し、終了枠を延長しない。

旧時刻を返す非同期応答、読取り待機、結果不明後のPOST再送禁止、readyになる前の解約禁止、待機上限を合成検証した。外部のClockを再度進めた証拠とは区別する。

関連通し検証14件合格。既存実行制御回帰240件中239件合格・1件環境依存skip。自己レビューでは、対象Clock・mode・時刻照合、書込み一度だけ、60秒内の終了処理、未承認のdraft操作が増えていないことを確認した。最終CIは修正コミットに対するGitHub Actions結果を別記録に保存する。

## 限定終了処理と残存状態

通常終了の解約は429で失敗。本人の追加承認に基づき、各最大60秒の限定終了処理を実施した。

1. Clock readyと今回のCustomer・契約・metadataを照合し、追加請求・日割りなしの即時解約1回。Stripe canceledを確認。
2. 更新draft 1件のauto_advanceをfalseへ1回更新。draft・未払い・自動処理OFFを読み取り確認。請求確定・支払い・削除・Clock前進なし。

EのAuth/profile/Customer/紐付け/Clock、解約済み契約、初回paid請求、更新draft請求を保持。Clockはreadyで停止した時刻のまま。Fは作られていない。商品・価格・default_price・Smart Retries変更なし。DB対象価格はactive=false。

**残る不一致：Stripe契約はcanceledだが、DBのE契約行はactiveのまま。** paid_throughは2026-10-26T03:52:50Zで既に過去、consultation_entitlementはFree。通知受信プロセス停止後に限定解約したため、実解約通知による更新の証拠はない。現在Freeという結果で遷移や契約表示の整合を合格にしない。今回、DBを直接書き換えたり実イベントを再送したりしていない。

既存C/D側の3テーブルの行数・fingerprintは開始前と一致。算出式は `md5(string_agg(to_jsonb(t)::text, '|' order by id))`、今回Eを除外。subscriptions 2件=`0ee8a62ade0729f75a40ac20a6a8fbaf`、billing_customers 1件=`6fd74b0ff3f18c432f40ef35b0e6041e`、subscription_invoices 2件=`ff9561857ead075325316e71b910bd4d`。本文の取得・変更なし。

専用アプリ・受信プロセス停止を実行記録で確認。受渡しサーバー閉鎖、一時Stripe資格情報ファイルと受渡しURLファイルの削除完了。過去ツール出力やURLの失効・消去を意味しない。

## キー失効の証拠を分離

今回のlistener/app/lifecycle（接頭辞 `yorisoi-monthly-ee8a0f00-`）3件について、本人は全部失効したと申告した。

終了待機の期限に先に実行されたAPI照合では、listenerはrevoked、app/lifecycleはその時点でstill_validだった。その後に本人の「全部失効した」が届いた。一時資格情報は削除済みなので再取得・再発行して検証しない。最終分類はlistener「API失効確認＋本人申告」、app/lifecycle「本人失効申告あり・申告後のAPI確認なし」。古いAPI結果を現在も有効である証拠にはしない。

## 公開までの残条件と必要な差分

- EのStripe canceledとDB activeの整合を、今回Eだけの終了同期として修復する具体的な承認が必要。実Webhook成功の証拠として扱わず、sourceを終了処理として記録する。イベント再送は別承認。
- 更新・期間末解約・実解約通知解除は未実証。Eを新たに再契約してこれらを検証し、未作成Fで失敗検証を行うなら、累積契約3件・成功支払い4回になる。現承認の契約2件・成功3回を超えるので実行しない。既存Eのユーザー・Customer・Clockを再利用する案で、作り直しや履歴削除は不要。
- 実AIは計数API課金条件の裏付け、または計数方法を変更する具体的承認が必要。料金不明のまま呼び出さない。
- 以上の未実証項目があるため、月額Plus・AIを含む公開を合格扱いしない。外部33件の既存分類・比較基準を維持。マージ・デプロイ・本番公開なし。
