# Stripe本番移行の準備（まだ実施しない）

現在はAI Fortune テストSandboxのみ。アプリはtest key以外、live Price/Session/Eventを明示的に拒否する。鍵を差し替えるだけでは本番化できない。この防止コードは今回維持する。

## 運営者の明示承認後に行う順序

1. Stripe本番アカウントの本人確認、販売主体・責任者・住所・連絡先・入金先・明細表示名を運営者が確定。提出・契約同意は本人が行う。法務ページと整合させる。
2. 本番Product/Priceを別に用意。1回1980円JPY、自動更新なしを検証。SandboxのIDを流用しない。
3. 最小権限の本番用APIキー（必要な権限を持つrestricted keyを優先）と本番Webhook Secretを本番環境だけにSecret登録。テスト環境、GitHub、ブラウザbundle、ログへ入れない。既存Sandbox鍵・Webhook Secretを上書きしない。
4. 本番DBとテストDBを分離するか、別途レビューした環境識別・一意制約・Webhook検証で混在を防止する。現在のpaymentsにlivemode列はなく、同一DBで無計画に混用しない。
5. 本番Webhook URLは正式URLの `/api/webhooks/stripe`。現在の候補は https://partner-mind-vdiordna-2059.vercel.app/api/webhooks/stripe 。本番とSandboxの送信先・署名鍵を区別する。リダイレクト先画面だけで支払済みにしない。
6. test-onlyガードを、明示された環境とPrice/Session/Eventのlivemodeが一致するときだけ許可する実装へ変更・レビュー。署名検証、金額/通貨/決済IDの一致、重複通知、遅延決済、期限切れ、返金通知のテストを再実施する。
7. 本番Checkout→署名通知→payments.paid→paid_reports.readyを確認。実支払いの試験は金額・実行方法について別途承認を得る。承認前に実請求を作らない。
8. 返金依頼は本人確認→対象決済照合→Stripeの返金確定→Webhookでrefunded/revoked→レポート閲覧停止を確認。現在は部分返金でも閲覧停止になるため、MVPは全額返金の運用を前提にし、部分返金を導入するなら設計を分ける。DBだけを先にpaid/refundedへ書き換えない。
9. 販売開始・法務・保存期間・認証メール到達が整った後、テスト表示を正式表示へ変更。検索公開は別の明示承認後に切り替える。mainへのマージも別途承認を得る。

[Stripe go-live checklist](https://docs.stripe.com/get-started/checklist/go-live) / [Sandbox](https://docs.stripe.com/testing/overview)
