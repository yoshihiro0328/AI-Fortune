# Verification — 2026-10-06

ローカルで無料診断→実Stripe Sandbox決済→真正な決済通知→有料AIレポート生成→再表示を確認済み。MVP全体は未完了：GitHub保存を進行中。Vercel Preview上のE2Eは未検証。

## Passed

- `npm run lint` / `npm run typecheck` / `npm test`: 19 tests passed.
- `npm run build`: Next.js 16.3.8の通常Turbopackビルド成功。
- `npm audit --omit=dev`: 0 vulnerabilities。
- Supabase実プロジェクトへ2 migrations適用。19テーブルのRLS有効、質問10問。
- `tests/database.sql`を実Supabaseへ適用し全assertion成功。変更はrollback。匿名回答保存、未決済の生成拒否、支払確定、重複通知、別イベントの重複通知、生成lease、誤token拒否、遅延失敗通知、返金後失効、返金後の遅延成功通知、制限、権限を検証。
- `npm run test:http`: 実ローカルAPI+SupabaseでCSRF、匿名作成・保存・再開、他者アクセス拒否、未払いレポート閲覧・生成拒否、診断前Checkout拒否、偽Webhook拒否に成功。
- ブラウザ: TOP→開始→7選択質問→再読み込み→8問目から復帰→10問回答→実OpenAI分類/追加質問判定/分析/無料レポート→結果表示。
- OpenAIモデル `gpt-6.1-sol` がアカウントで利用可能なことをmodels APIで確認。上記4段階すべて成功。分類約6秒、追加質問判定約3秒、分析約18秒、無料結果約12秒。
- 保存済み無料結果を表示。有料レポートは未決済時点で0件。
- 390px幅のTOP・開始画面で横スクロールなし。無料結果の実画面も390px幅で保存。
- ブラウザconsole errors: 0（上記無料フロー）。
- Stripe Sandbox商品とJPY 1,980のone-time priceを実作成。livemode=false。
- Vercel初回配置はREADY。重要: target=previewを送信したが応答/取得結果はtarget=production。Preview成功とは記録しない。

## Actual resources

- GitHub: https://github.com/yoshihiro0328/AI-Fortune （再接続後の書き込み成功、開発ブランチ作成済み）
- Local branch: codex/partner-mind-mvp
- Supabase: rnvrdrfdbapfafwjbygo / partner-mind / Tokyo / AI Fortune
- Stripe Sandbox: AI Fortune テスト / acct_1UNSvsIYwtQeIHKP
- Product: prod_VOFggeiH0DgaPL
- Price: price_1UNTB4IYwtQeIHKP6tKc0L8s
- Vercel project: prj_woDHhEYaDMdDXq4t4C2jfdC6L8pv
- First deployment: dpl_C7CvtbdRryhMVGj8PDZT3PUXbv1A
- URL: https://partner-mind-g0n4jhm7r-vdiordna-2059.vercel.app (Vercel sign-in required)

## Blocked / not yet verified

1. Stripeキー設定は解消。Sandboxアカウント一致・JPY 1,980価格をAPIで確認。公式テストカードでCheckout支払い成功。Stripe CLIから本物の決済通知をローカルへ転送しHTTP 200、DB支払状態paid。実請求なし。
2. GitHub権限は再接続で解消。初回READMEと開発ブランチの作成に成功。コード保存・PR・CI確認を進行中。
3. Vercelの最初の配置がproductionになる挙動を受け、再配置は自動承認レビューで拒否。ユーザーへテスト専用としての再配置許可を確認中。
4. Vercel PreviewへSupabase公開値・セッション鍵・Cron鍵・Stripe価格IDは登録済み。OpenAI/Supabase秘密鍵の転送は、ツール出力への露出懸念で自動承認レビュー拒否。秘密値を出力しない登録経路が必要。実行中の初回production配置には登録していない。
5. Vercel build/runtimeログ取得は403。CLI代替も権限回避の懸念で自動承認レビュー拒否。ログに問題が無いと断定しない。
6. ローカル有料E2Eは成功。Stripe公式CLIでSandboxの本物の通知を転送し、署名検証後に支払確定。初回生成タイムアウトを修正し、追加課金なしの再開から13項目を実生成・表示。公開環境のWebhookは未設定。
7. Supabase Authのメールリダイレクト設定と実メール認証は未検証。ユーザー操作以外のメール送信は行っていない。
8. 法務/保存期間/問い合わせ窓口は要設定。GA4・広告・月額等は未実装。

## Review notes

- Supabase security advisorは9件のINFO「RLS有効・policyなし」。これらはサーバー専用テーブルでanon/authenticated権限も取消済み。アクセスを許可するpolicyを追加して警告だけを消すことはしない。
- 開発用eslint依存にbraces経由のhigh advisoriesが5件。braces最新3.0.3時点で修正版なし。任意の外部globはlintへ渡さない。実行時依存のauditは0件。
- 必要な追加検証: 追加質問ありのケース、別ブラウザからの支払済みレポート拒否、Supabase Auth後の紐付け。

## Paid flow follow-up

- 有料レポート生成の45秒タイムアウトを実検出（2回）。有料段階のみ120秒×2回に変更。300秒の実行上限に収めるためCronは1件ずつ、画面は300秒まで状態確認。
- 支払済みレポートの所有者Cookieなしアクセスは401。
- 再開した有料AI生成は約57.5秒で成功。DB payments=paid、paid_reports=ready・attempts=2。ページ再読み込み後も13項目を表示。ブラウザconsole errors=0。
- 確認画像: `../stripe-test-checkout.jpg`、`../paid-report-desktop.jpg`。
