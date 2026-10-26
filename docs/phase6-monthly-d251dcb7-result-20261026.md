# 月額残試験 d251dcb7 の結果（2026-10-26）

対象Sandbox `acct_1UQlQdI73kTcvXz8`、DB `ukdzggjfkcwjssjmnqim`。承認済み①②の差分で実施。Aの更新・期間末解約・実解約Webhookによる権限解除・支払い失敗・再試行終了を実証。Bは計数APIの課金条件未確認により実呼出し0で停止中。A/B全体の完了や本番公開可能とは判定しない。

## 実測

| 工程 | 判定・証拠 |
| --- | --- |
| G初回 | 980 JPY paid、実invoice.paid署名検証・HTTP200・同じイベントのDB commit。初回過去期間はFree |
| G月額更新 | 980 JPY paid、請求2件、paid_through延長、現在Plus |
| G期間末予約 | 実customer.subscription.updatedのcommit、active、cancel_at_period_end=true、Plus維持 |
| G期間末終了 | 実customer.subscription.deletedのcommit、canceled、PlusからFree。追加請求なし |
| F失敗 | 初回980 JPY paid後、失敗用支払方法へ1回切替。実invoice.payment_failed、past_due、paid_through延長なし、Free |
| F再試行終了 | 請求のattempt_count=9。実customer.subscription.deletedのcommit、canceled・Free |
| 終了処理 | G/Fとも既にcanceledなので追加の即時解約要求なし。Fの未回収open請求1件をvoid、応答で確認 |

Fは過去期間の初回時点からFreeであり、失敗をPlus→Freeの実遷移と呼ばない。Plus→Freeの前後証拠はGの期間末終了で成立。過去CやEの未記録の遷移を今回の成功へ読み替えない。

以下はすべてSandbox実通知。署名検証=true、HTTP200、同じイベントIDの処理済みDB行、同じ契約、状態観測を照合。観測区間のwriterはWebhookのみで、通常GET billingや終了処理の直接更新を代用していない。

| 観測時刻（JST） | 対象 | イベント | 非秘密イベントID | 状態／権限 |
| --- | --- | --- | --- | --- |
| 15:59:32 | G | `invoice.paid` | `evt_1UUhsLI73kTcvXz86rmX5aqQ` | active / free |
| 15:59:55 | G | `invoice.paid` | `evt_1UUhsnI73kTcvXz8TPkkB9V0` | active / plus |
| 16:00:01 | G | `customer.subscription.updated` | `evt_1UUhsuI73kTcvXz8epEBIr7B` | active / plus |
| 16:00:08 | G | `customer.subscription.deleted` | `evt_1UUht3I73kTcvXz8ZTIAgUOZ` | canceled / free |
| 16:00:26 | F | `invoice.paid` | `evt_1UUhtDI73kTcvXz8q0wcI269` | active / free |
| 16:00:46 | F | `invoice.payment_failed` | `evt_1UUhtbI73kTcvXz8YYGGiV4n` | past_due / free |
| 16:02:13 | F | `customer.subscription.deleted` | `evt_1UUhuzI73kTcvXz8hefvk3MW` | canceled / free |

## 使用量・保持対象

今回：Auth/profile/Customer/紐付け/Clock/契約はG/F各1件、成功Sandbox支払い3回×980 JPY、失敗9回、Clock前進13回（G3/F10）。過去Eを含む累積は対象各3件、成功4/4回、失敗9/9回、Clock14/16回。初回3件とG更新1件、テスト額合計3,920 JPY。実金銭支払い0。予約カウンターのfailedPaymentAttemptsは能動的API予約用で0のため、実失敗数にはStripe請求のattempt_count=9を使用。

識別完了から通知試験終了までの観測時間は180.647秒、終了処理記録の区間は1.783秒。本体20分・通常終了60秒・本人失効待ち5分以内。一時資格情報の期限延長なし。

G：user `6269ea8e-00de-4bfe-afa9-08adbc174526`、Customer `cus_VVjKjZsosyJOxr`、契約 `sub_1UUhsHI73kTcvXz826ApbQsZ`、Clock `clock_1UUhsDI73kTcvXz859IGiWbw`。
F：user `3cae76ee-246b-4925-9965-e6c813ff77e3`、Customer `cus_VVjLJZH7twK75d`、契約 `sub_1UUhtAI73kTcvXz84haMdr7q`、Clock `clock_1UUht7I73kTcvXz8ltyG7Dhw`。

Auth/profile/Customer/紐付け/Clock/契約・請求履歴を保持。旧Eも保持し、以前のdraft未払い・自動処理OFF記録は維持（今回はそのStripe再読取なし）。

## 後片付け

- G/FはStripe結果と終了後DB読取でcanceled、権限RPCはFree。Gのcancel_at_period_end=trueは保持された予約履歴でありactiveの意味ではない。
- F未回収請求 `in_1UUhtTI73kTcvXz8A5G9yG5Y` はvoid応答確認。追加支払い・請求確定・削除なし。
- 既存C/D/Eのsubscriptions、billing_customers、subscription_invoicesは試験前後の行数・ハッシュ一致。E終了同期以降の比較基準を使用。
- Stripe商品/価格/default_price、Smart Retriesの書込なし。終了後UIでON・Smart・2週間・8回・最初の失敗past_due・終了後cancel・請求openを確認。DB価格active=false。
- 今回3キーは本人失効申告後、各1回のAPI確認ですべてrevoked。過去試行の証拠区分は変更しない。
- 専用アプリ・受信プロセス停止、5218/5219閉鎖、受渡しサーバー閉鎖。一時Stripe資格情報と受渡しURLファイル削除。過去の出力やPortal URLが消去・失効したとは扱わない。

## 検証と公開前の残項目

修正コミット `4ab722bfd71e1298bc05d954fe69ebb3766eff4b` はレビューと[CI 40281245915](https://github.com/yoshihiro0328/AI-Fortune/actions/runs/40281245915)成功。関連33件、ローカル回帰244合格/1環境依存skip、実アプリ・署名handler・隔離SQLの2経路も合格。今回の外部試験でコード変更は追加していない。

| 残項目 | 必要な対応／本人操作・費用・外部変更 |
| --- | --- |
| Bの実AI（相談01–14、診断29–31） | 計数API課金条件の根拠、または計数方式の具体的変更判断が必要。最大842生成・税別12 USD・gpt-6-luna Standardの承認は維持。計数0/生成0、費用推計0 USD（請求確定値ではない）。実品質サンプルなし。新資格情報・生成は開始していない |
| 外部33の残差 | 更新・失敗・再試行終了・期間末・実解約通知の不足を解消。旧33件一括テスト全体を合格にしない。アプリの期間末操作UI、公開先への直接Webhook配送・監視など環境差は別途確認。既存の初回・Portal・アクセス拒否・RLS・即時解約成果を保持 |
| 公開環境・運用 | 本番対象/価格/mode/署名秘密保管、HTTPS/ドメイン、認証メール、通知失敗監視・復旧、販売/解約説明の受入。変更対象と復旧案を固定し別承認。未知の有料サービス導入なし |
| 旧Portal URL | 個別失効・期限切れ未確認。今回再掲/再利用なし。公開ログで秘密URLを収集しない設計を維持。追加サポート送信は未実施 |
| 匿名相談・反復評価・既存本文編集 | 既存の機能別分類を維持。匿名OFFなら匿名実試験は延期可能。相談15–28の反復、32の一括編集は初回安全/品質合格と監視を条件に後回し可能。公開機能を勝手に削らない |

マージ・デプロイ・本番公開なし。新たな購入・再契約・キー発行は追加しない。
