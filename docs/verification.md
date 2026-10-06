# Verification — 2026-10-06

Vercelのテスト公開環境で、無料AI診断 → Stripe Sandbox決済 → 署名付き決済通知 → 有料AIレポート13項目 → 再表示まで確認済み。実請求なし。商用公開前の残件は下記参照。

## Hosted verification

- URL: https://partner-mind-vdiordna-2059.vercel.app
- Deployment: dpl_AELqkZTpWW13VeaQFuNGzU65KemK / READY / target=staging
- Application source: e5a648d64e4f00fc9f64eb8b9881d0f54f76724d
- ユーザーの明示許可によりVercelログイン制限を解除。未認証HTTP 200。
- 必要な接続設定をPreview環境へ暗号化/Secretで登録。秘密値をGitHubやツール出力へ含めていない。
- 架空の成人同士の相談をブラウザで10問入力。Supabase保存、実OpenAIの分類・追加質問判定・分析・無料レポートの4段階が成功。
- Hosted diagnosis: f371e634-931c-43fe-b923-33a6d5a9a6f4
- Stripe Sandboxの公式テストカードでJPY 1,980の一回払いが成功。実請求なし。
- Hosted webhook: we_1UNVR9IYwtQeIHKP4P1WirXK。公開URLの /api/webhooks/stripe に配送。ローカルStripe CLI転送を停止した状態で確認。
- DB payments=paid、paid_reports=ready、attempts=1、report_json=13項目。有料AI生成65,173ms。
- 有料レポート全13項目が表示され、再読み込み後も表示。ブラウザconsole errors=0。
- 所有者Cookieなしの公開レポートAPI=401。偽Webhook=400。
- 確認画像: ../hosted-paid-report.jpg

## Automated and local checks

- GitHub Actions run 37446216029: npm ci / lint / typecheck / 19 tests / build 全成功。
- Next.js 16.3.8、通常Turbopack build成功。実行時依存audit=0 vulnerabilities。
- Supabaseへ2 migrations適用。19テーブルでRLS有効、質問10問。
- tests/database.sql の実DB assertionがすべて成功、変更はrollback。支払確認・通知重複・lease・返金後失効・制限・権限等を検証。
- ローカルHTTP smoke: CSRF、匿名作成・保存・再開、他者アクセス拒否、未払いレポート拒否、診断前Checkout拒否、偽Webhook拒否が成功。
- ローカルでも実無料AI → テスト決済 → 署名付き通知 → 詳細レポート → 再表示に成功。
- 初回の有料生成45秒タイムアウトを修正済み。有料のみ120秒×2回、Cron1件/実行、画面は300秒まで確認。ローカル再開から生成成功。
- 390px幅のTOP・開始画面に横スクロールなし。無料結果も390px幅で表示確認。

## Resources

- GitHub: https://github.com/yoshihiro0328/AI-Fortune
- Draft PR: https://github.com/yoshihiro0328/AI-Fortune/pull/1
- Branch: codex/partner-mind-mvp
- Supabase: rnvrdrfdbapfafwjbygo / partner-mind / Tokyo / AI Fortune
- Stripe Sandbox: AI Fortune テスト / acct_1UNSvsIYwtQeIHKP
- Product: prod_VOFggeiH0DgaPL
- Price: price_1UNTB4IYwtQeIHKP6tKc0L8s
- Vercel project: prj_woDHhEYaDMdDXq4t4C2jfdC6L8pv

## Remaining work and limitations

1. Supabase Authの公開URLリダイレクト設定・メール認証・診断紐付けは未検証。Dashboardはログイン画面で停止。接続ツールにAuth設定変更機能なし。無断の認証メール送信はしていない。
2. 法務ページの運営者情報・保存期間・問い合わせ窓口は要確定。実決済を有効化していない。
3. 安全検知の単語ルールは否定文にも反応する。「暴力や脅しはありません」を含む架空相談でsafety画面へ遷移し、有料案内が停止。誤検知の改善が必要（安全判定の無効化はしていない）。
4. 追加質問が発生するケース、認証後の紐付けを含む追加検証は未実施。
5. GA4・広告・月額等は未実装。
6. Vercel connectorのbuild/runtimeログ取得は403のため未確認。実ブラウザ、公開HTTP、DBの証拠に基づく検証。
7. Supabase advisorの9件のINFO「RLS有効・policyなし」は権限を取消したサーバー専用テーブル。警告を消すための公開policy追加は行わない。
8. 開発用eslint依存のbraces経由high advisoriesが5件（確認時点で修正版なし）。実行時依存は0件。
