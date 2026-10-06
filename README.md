# よりそい — 相手の心理診断 MVP

無料診断 → OpenAI分析 → 無料結果 → Stripe Sandbox 1,980円 → 署名検証済みWebhook → 有料AIレポートのNext.jsアプリ。

## 状態

実装・検証の最新状況は `docs/verification.md`。実決済は禁止しており、`sk_test_` / `rk_test_` 以外はサーバーが拒否します。運営情報が未確定のため、本番販売可能とはしていません。

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
- `STRIPE_SECRET_KEY`: Sandboxのみ。`STRIPE_PAID_DIAGNOSIS_PRICE_ID`: JPY 1,980の一回価格。
- `STRIPE_WEBHOOK_SECRET`: この配置先Webhookの署名シークレット。
- `SESSION_SECRET`: 十分なランダム値。匿名Cookieのハッシュ用。変更すると匿名診断へアクセスできなくなります。
- `CRON_SECRET`: ジョブ再実行エンドポイント用。
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: 将来の埋め込みCheckout用。現在のリダイレクト式では不要。
- `NEXT_PUBLIC_GA_MEASUREMENT_ID`: 予約。GA4未実装・未送信。集計はDB内イベント。

秘密鍵をGitやチャット、ログへ書かないでください。VercelではPreview環境変数として暗号化して登録。

## Supabase

`supabase/migrations` のDDL・初期10問を適用。公開される19テーブルでRLS有効。匿名ユーザーは256bit HttpOnly CookieでサーバーAPIだけにアクセス。DBにはHMACのみ保存。ユーザー入力で所有者IDを変更できません。会員には所有レコードのみの読み取りRLS。書き込み・決済更新・ジョブRPCはservice_role専用です。

Supabase AuthのSite URLとRedirect URLsに `/auth/callback` を含む配置先を設定。メールリンクでログイン後、同じブラウザの匿名診断を一度だけ紐付け。メール送信はユーザーがフォームを送った場合のみ。

質問は `diagnosis_questions` で管理。公開中の質問を途中で編集する場合は既存診断との整合性を確認してください。現在は質問スナップショットの世代管理を未実装。

## OpenAI

`src/lib/ai/prompts` に分類・追加質問・分析・無料・有料・将来の広告推薦を分離。Zodによる構造検証、最大1回の再試行、保存済み結果の再利用。失敗時に偽の診断結果を返しません。入力はuserデータとして分離。危険語の早期検出とAI分類で安全フローへ。

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

1画面1質問、DB保存と再開、最大3追加質問、無料結果、危険相談の分岐、Checkout、Webhook、有料13項目、再生成、任意のメールログイン、法務7ページ、DBイベント。

- 運営者・住所・連絡先・保存期間・返金処理手順は要設定。法務ページは暫定案。
- GA4、継続相談、サブスク、広告推薦、n8n自動配信はMVP後。対応テーブル・格納先のみ。
- レート制限はセッション+Vercel提供IPのハッシュ。CAPTCHA・より厳密な不正利用対策は公開量に応じ追加。
- 保存済み回答のみ復帰。入力中でまだ「保存」していない本文は保存しません。
- プロンプト注入への完全な保証はありません。外部ツール実行は許可せず、スキーマ・所有権・決済の制御はAIに任せません。
- 匿名Cookie消失時の購入復旧は未実装。購入後は会員保存を案内。
- 自動生成が5回失敗したときは運営確認が必要。無期限にAI費用を発生させません。
