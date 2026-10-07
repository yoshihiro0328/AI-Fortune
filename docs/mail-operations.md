# メール・問い合わせ運用（2026-10-07）

アプリURL： https://partner-mind-vdiordna-2059.vercel.app
運営画面： /admin/contact

## 実装済み

- 問い合わせと受付通知・運営通知の送信待ち記録を1つのDB取引で保存。
- Resend送信。送信元、返信先、運営通知先を別々に指定。認証済みドメインのアドレスを使用。
- 受付メールに相談本文を転載しない。運営通知は保護された管理画面への案内のみ。
- 管理画面で問い合わせ一覧、対応状況、内部メモ、返信送信、送信状況、再試行。
- メール認証済みの担当者UUIDをサーバーの許可リストで確認。ユーザーが編集できるmetadataは権限判断に使わない。
- 送信時の内容と重複防止キーを保存。2分の排他制御。同一内容の再試行はResendの同一キーを使用。
- 初回試行から23時間を超えた未確定メールは「要確認」にし、自動再送しない。Resendの重複防止期限24時間を越えて二重送信しないため。最大5試行。受付直後・担当者操作・日次処理で送信する。
- 「送信サービス受付済み」は受信箱への到達証明ではない。配信失敗・迷惑メール振分はResend管理画面と受信箱で確認する。
- 返信先へ届いた返事は、担当者の受信箱で対応。受信メールの自動取り込みは未実装。

## 将来、自動メールを有効にするときの設定

現状、custom SMTPはOFF。独自ドメインなしのMVPでは、自動メールを有効にする必要はありません。Supabase標準認証メールと手動の問い合わせ対応を使います。現在の制限、受信手順、管理者指定は [公開前の運用手順](prelaunch-operations.md) を参照してください。以下は将来の自動送信導入時の手順です。実メールを送ったとは扱いません。

1. 所有する送信ドメインと正式なサポート用アドレスを確定する。
2. Resendでドメインを登録し、指定されたDNSレコードを所有ドメインに設定して認証する。契約・費用は選ぶプランで確認する。
3. Vercelの承認済みテスト環境に、RESEND_API_KEY、EMAIL_FROM（アドレスのみ）、EMAIL_REPLY_TO、CONTACT_NOTIFY_TO、OPERATOR_USER_IDSを登録する。鍵はGitHubやチャットへ貼らない。MAIL_ENABLED=trueは準備後に設定する。
4. OPERATOR_USER_IDSには、メール認証を完了した実際の運営担当者のSupabaseユーザーUUIDを設定する。未設定なら全員拒否。
5. Supabase Authに同サービスのSMTP接続設定を登録する。送信元名は「よりそい」、送信元アドレスは認証したドメインを使用。Resend API設定だけではSupabase Authメールは切り替わらない。
6. Supabase「Confirm signup」にemail-templates/confirmation.html、「Reset password」にrecovery.htmlを設定する。件名は「【よりそい】メールアドレスを確認してください」「【よりそい】パスワードの再設定」。再送はConfirm signupと同じテンプレート。
7. Site URLは上記アプリURL。Redirect URLsは /auth/callback と /auth/callback?next=recovery の完全なHTTPS URL。ワイルドカード不要。ConfirmationURLをそのまま使いPKCEフローを保持する。
8. 所有する受信箱で登録→確認リンク、再送、パスワード再設定、問い合わせ受付、運営通知、返信を順番に確認する。From・Reply-To・日本語・リンク先・迷惑メール判定も確認する。パスワードの入力変更は本人が行う。
9. 送信失敗は管理画面から再試行。「要確認」はプロバイダーの履歴を確認し、同じメールを無条件で新規送信しない。

Supabaseの標準送信では許可される宛先や送信数が制限される。HTTP 200だけで到達済みとは判断しない。

根拠： https://supabase.com/docs/guides/auth/auth-smtp 、 https://resend.com/docs/dashboard/emails/idempotency-keys
