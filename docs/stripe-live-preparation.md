# Stripe本番移行準備（販売開始前）

最新の環境分離設計、SQL修正、検証結果、必要な設定と適用順序は [実DB適用前レビュー](stripe-isolation-review.md) を参照してください。

現在稼働中のサイトはSandboxです。新コードは`STRIPE_MODE`、実行環境、APIキー、Stripeアカウント、DB、料金・livemodeを照合します。Live Checkoutは追加の明示スイッチがない限り停止します。Live料金は既存Sandbox料金を上書きしない別レコードです。

`20261013074636_stripe_environment_isolation.sql` は実DBへ無条件で再送しないでください。まず読み取り用preflightで履歴・列・関数・トリガーを照合します。今回の検証は隔離DBとモックまでで、実DB適用・Preview更新は承認待ちです。

既存Sandbox DBをLiveに変換しません。新しい空のLive DBでだけ `supabase/review/initialize-empty-live.sql` を使います。固定PreviewをLive Webhookの送信先にしません。Live Secret・Production公開・実請求は今回実施していません。
