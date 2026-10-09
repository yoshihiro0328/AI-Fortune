# よりそい — 相手の心理診断 MVP

無料診断から相手別の継続相談へ進めるNext.jsアプリ。無料月3回、Plus月額980円・請求期間30回、単発詳細診断980円。Stripe Sandbox専用。過去の1,980円購入は金額と閲覧権限を維持。

## 状態

実装・検証の最新状況は `docs/verification.md`。実決済は禁止しており、`sk_test_` / `rk_test_` 以外はサーバーが拒否します。Previewの運営情報は設定済みです。現在はテスト決済のみで実請求は発生しません。

## Stack

Next.js App Router / TypeScript / React / Tailwind CSS / Supabase PostgreSQL + Auth / OpenAI Responses Structured Outputs / Stripe Checkout / Vercel。Node.js 24。依存バージョンはpackage-lock.jsonで固定。

## Development

```sh
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` の値を設定します。既存ファイルを上書きしないでください。ローカルでファイル監視制限に遭遇した場合は `WATCHPACK_POLLING=true npm run dev -- --webpack` を使えます。

## Environment variables

- `NEXT_PUBLIC_APP_URL`: Cookie/CSRF/決済・Auth戻り先の固定オリジン。PreviewではそのPreviewの固定エイリアス。
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: プロジェクトURLと公開用publishable key。
- `SUPABASE_SERVICE_ROLE_KEY`: サーバー専用のSupabase secret/service role。
- `OPENAI_API_KEY`, `OPENAI_MODEL`: Structured Outputs対応モデル。モデル名は運営が選択。
- `OPENAI_INPUT_USD_PER_MILLION`, `OPENAI_OUTPUT_USD_PER_MILLION`: 任意。価格未設定時の原価はnull（ゼロとは記録しない）。
- `STRIPE_SECRET_KEY`: Sandboxのみ。新規価格はDBの`price_versions`で管理。`STRIPE_PAID_DIAGNOSIS_PRICE_ID`は旧購入の参考設定として残り、新規Checkoutには使用しません。
- `STRIPE_WEBHOOK_SECRET`: この配置先Webhookの署名シークレット。
- `SESSION_SECRET`: 十分なランダム値。匿名Cookieのハッシュ用。変更すると匿名診断へアクセスできなくなります。
- `CRON_SECRET`: ジョブ再実行エンドポイント用。
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: 将来の埋め込みCheckout用。現在のリダイレクト式では不要。
- `NEXT_PUBLIC_GA_MEASUREMENT_ID`: 予約。GA4未実装・未送信。集計はDB内イベント。

秘密鍵をGitやチャット、ログへ書かないでください。VercelではPreview環境変数として暗号化して登録。

## Supabase

`supabase/migrations` のDDL・初期10問を適用。管理する20テーブルでRLS有効。匿名ユーザーは256bit HttpOnly CookieでサーバーAPIだけにアクセス。DBにはHMACのみ保存。ユーザー入力で所有者IDを変更できません。会員には所有レコードのみの読み取りRLS。書き込み・決済更新・ジョブRPCはservice_role専用です。

Supabase AuthのSite URLとRedirect URLsには公開URLと `/auth/callback`、`/auth/callback?next=recovery` を登録済み。メール＋パスワード登録、確認メール再送、ログイン、ログアウト、再設定に対応。確認済みユーザーへ匿名診断と支払いを一度だけ紐付けます。カスタムSMTPは未設定で、実際のメール到達は本番開始前に確認が必要です。

質問は `diagnosis_questions` で管理。公開中の質問を途中で編集する場合は既存診断との整合性を確認してください。新規診断はv2として選択済み質問のスナップショットを保存し、既存v1はそのまま維持します。動的質問の仕組みは [動的診断](docs/dynamic-diagnosis.md) を参照。

## OpenAI

`src/lib/ai/prompts` に分類・追加質問・分析・無料・有料・将来の広告推薦を分離。Zodによる構造検証、最大1回の再試行、保存済み結果の再利用。失敗時に偽の診断結果を返しません。入力はuserデータとして分離。軽量ルールを参考に、否定や矛盾を考慮したAI文脈分類で安全フローへ。単語一致だけで通常相談を停止しません。追加回答後は再分類します。

## Operator, contact and indexing

`.env.example` の `OPERATOR_*`、`DATA_RETENTION_POLICY`、`REFUND_REQUEST_PERIOD`、`SUPPORT_RESPONSE_TIME` を正式な情報で設定します。未設定時は明示的なプレースホルダーを表示します。問い合わせは `contact_messages` に保存し、Supabase管理者がTable Editorで `status` / `admin_note` / `resolved_at` を管理できます。自動返信は未実装です。

`PUBLIC_INDEXING_ENABLED` はテスト環境では未設定のまま。正式公開時に `true` としても個人ページは検索対象にしません。

## Stripe Webhook

`POST /api/webhooks/stripe` に次を配信:

- checkout.session.completed
- checkout.session.async_payment_succeeded
- payment_intent.payment_failed
- charge.refunded

raw bodyの署名を検証、Sandbox/金額/通貨/購入ID/決済状態をチェック。Postgres関数がイベント重複防止・購入確定・生成ジョブ作成を同一トランザクションで実施。成功URLから閲覧権限を付与しません。イベントIDだけでなく診断・支払単位の一意制約を使用。

生成はWebhook応答後の`after()`で開始。Postgresにジョブが残るため中断後も再開可能。leaseとtokenで同時生成を抑制。最大5回、利用者が無料再試行でき、Vercel Cronが日次で補助します。返金は部分返金も含め閲覧を失効。過去の成功イベントでも復活しません。

## Test / Build

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`tests/database.sql` は専用テストプロジェクトで実行してください。トランザクションをrollbackする合成テスト。匿名保存、未払い拒否、購入確定、重複通知、重複生成、遅延イベント、返金、制限、RLSを検証します。実ブラウザ検証は `docs/verification.md` に別記し、モックテストを外部連携の成功と扱いません。

## Deploy

GitHubブランチ `codex/partner-mind-mvp` をVercel Previewへ接続。Preview用環境変数、Authリダイレクト、Stripe Sandbox Webhookを設定して再配置。WebhookはStripeから到達可能な必要があります。Vercel保護設定を無断で解除しないでください。

## MVP scope / known limitations

1画面1質問、DB保存と再開、最大3追加質問、無料結果、危険相談の分岐、Checkout、Webhook、有料13項目、再生成、任意のメール＋パスワード認証、診断履歴、問い合わせDB保存、法務7ページ、DBイベント。

- Previewの正式な運営情報・保存方針・返金方針・回答目安は環境変数から表示。8項目が揃うと未設定の注意文を非表示にします。
- 継続相談・Sandboxサブスク・管理者集計を実装済み。GA4、広告推薦、n8n自動配信は未導入。詳細は[継続相談の検証](docs/continuation-verification.md)を参照。
- レート制限はセッション+Vercel提供IPのハッシュ。CAPTCHA・より厳密な不正利用対策は公開量に応じ追加。
- 保存済み回答のみ復帰。入力中でまだ「保存」していない本文は保存しません。
- プロンプト注入への完全な保証はありません。外部ツール実行は許可せず、スキーマ・所有権・決済の制御はAIに任せません。
- 匿名Cookie消失時の購入復旧は未実装。購入後は会員保存を案内。
- 自動生成が5回失敗したときは運営確認が必要。無期限にAI費用を発生させません。

## 無料範囲での公開前準備

2026-10-07の最新状況は [公開前検証](docs/prelaunch-verification.md) を参照。標準SMTPの制限と本人の受信テストは [運用手順](docs/prelaunch-operations.md)、削除・退会は [データ削除](docs/data-deletion.md)、将来の本番決済は [Stripe移行準備](docs/stripe-live-preparation.md) に整理。現在は検索非公開・Sandbox専用を維持する。
