# 匿名相談：設計、検証境界、運用・復旧手順

## 有効化状態

**初期状態はOFF。実DB未適用・デプロイ未実施。** `TRIAL_ENABLED=false`、DB `trial_private.settings.enabled=false`。実行環境sandbox・Stripe sandbox・Vercel Production以外・予算検証済み・保持検証済みのサーバー設定がすべて必要。現時点では検証済みフラグをtrueにしない。

## 予算・AI

- nano USD整数（1ドル=1,000,000,000）で管理。匿名Sandboxだけに日$3、直近30日$90。日付はAsia/Tokyo。既存会員AI・決済には影響しない。
- `settings`の一行をロックし、セッション枠と予算を同一トランザクションで予約。新規callは記録が成功するまでAIを呼ばない。残高はsettledまたはreservedを集計する。
- `gpt-6-luna` Standardの入力最大単価（cache writeを含む）$0.125/M、出力$0.50/M。入力3000・出力1200 tokenの最大費用に2倍の余裕を予約：**$0.00195/呼出し**。料金表はモデル名・version・有効期限を持ち、未知/期限切れは停止。
- 公式input token countに、実際と同じsystem/user/schemaを渡し、全入力3000超なら生成しない。max_output_tokens=1200は推論込み。再試行・上位モデルfallback・ツール呼び出しはなし。store=false、service_tier=default。
- 成功/失敗にかかわらずusageがあれば精算。タイムアウト・通信切断・worker消失など費用不明は予約を保持。生成前の不実行が分かるときだけ解放。1セッション最大3試行、成功は1回答。成功していない失敗は成功回数を減らさない。
- リクエストIDと本文HMACで同一再送を返し、異なる内容は409。90秒リースと世代tokenで古いworkerを遮断。再試行時は新しい費用予約が必要。
- providerがtoken上限や予約費用を超えた場合は実績を記録してDBスイッチをOFF。ただし、検知した呼出しの既発生請求を取り消す仕組みではない。
- **アプリの予約上限は最終請求額の絶対保証ではない。** 料金変更・計数仕様・提供者の異常・税・別リクエスト・日付境界の計上差は残る。専用Sandbox OpenAIプロジェクトと実効的な提供者側制限、実token照合を確認するまで有効化しない。ダッシュボードの警告予算だけをhard capと扱わない。

参照：[OpenAI料金](https://developers.openai.com/api/docs/pricing)、SDK 7.28.0 のresponses.inputTokens.count / responses.parse。

## データとアクセス

- `yorisoi_trial`は256bit不透明Cookie（HttpOnly、SameSite=Strict、HTTPS環境Secure）。DBにはHMACのみ。既存診断用`yorisoi_session`（90日）と完全に分離。
- `trial_private.sessions/turns`に相談を保持。本文・任意項目・AI回答はAES-256-GCM。session HMAC、requestId、入力/出力をAADとして他セッションで復号できない。本文を通常ログやURL、ブラウザー永続ストレージに出さない。
- 所有Cookieだけで回答を再取得。期限が過ぎれば読めない。原文を消しても回数・不正対策は期限まで維持。
- 新表はRLS有効、anon/authenticatedへ一切権限なし。RPCはSECURITY INVOKER・空search_path・service_roleのみ。ブラウザー用roleから直接表やRPCを操作できない。
- 共通AIエンジンにはブランド固有のpromptを置かない。DB上のブランドはyorisoi、環境はsandboxをCHECKで固定。別ブランドへ履歴や個人情報を自動共有しない。

## 不正対策と任意の引き継ぎ

- Turnstileの署名検証、hostname、action、5分期限、challenge再利用拒否。クライアントが送ったX-Forwarded-Forは使わない。Vercel Previewのx-vercel-forwarded-forまたは開発中のlocalhostだけ許可。
- IP HMACあたり発行10/h・50/24h、回答成功+処理中3/24h。全体発行1000/24h。Cookie/アカウントを替えてもIP枠は復活しない。新規登録試行をIPあたり3/24hに追加。既存の無料月3/Plus月30は不変。
- IPは個人識別ではない。共有回線の誤検知やVPN・複数回線の回避は残る。challenge/全体予算と組み合わせるが完全防止とは言わない。
- 引き継ぎはログイン後にチェック操作とボタンで明示。同意時に表示したemailとサーバー再認証結果も照合。DBでauth.users.email_confirmed_atを再確認。
- Cookieの所有session・ready状態・期限・未削除・未claimをトランザクションで確認し、新しい相手/会話/ターンを作成。匿名ターンはcharged=false。既存月枠にカウントしない。別アカウントへの二度目の移行を拒否。同じ本人の再送は同じthreadIdを返す。
- 「あとで整理」は移行ごとに独立subjectを作る。既存threadの記憶と混ぜない。テーマ/任意項目は所有者付きtrial_thread_contextへ保存し、元の本文にも表示ラベル付きで渡す。
- 引き継ぎ後は匿名側の本文を消す。メール確認が別ブラウザーの場合、元のCookieがなければ移せない。既存匿名診断の保存は従来の処理を維持する。

## 保持期間と削除

| 対象 | 目的・保持 |
|---|---|
| 本文・回答・任意項目・匿名生成状態 | session作成から24hで読み取り拒否。cleanupでsessionsを削除しturnsはcascade削除 |
| Cookie/HMAC/IP・利用済み情報・claim receipt | session期限まで。CookieはmaxAge=86400。IP発行/成功counterは1h/24h、期限後cleanup |
| challenge HMAC | 単回使用を保証するため7日。本文や生IPを含まない |
| 費用台帳 | ローリング30日制限と突合のため35日。本文・生IP・Cookie・user_idなし。session消去時はturn参照NULL |
| 会員へ明示保存済みの相談 | 既存会員の保持・削除方針へ移行。匿名データの24h削除とは別 |
| 既存匿名診断 | 従来の90日。有効期限とデータを変更しない |

`GET /api/cron/trial`は専用Bearerで保護。`trial_cleanup()`が期限切れ本文、challenge、counter、新設signup制限の期限切れキーを削除しheartbeatを記録。heartbeatが10分以上古い場合、新規発行・AI予約は停止する。

**実際の定期実行は未設定。** 承認後、1分等の十分短い周期で実行・監視する。現在のVercel cron設定は変更していない。新規有料リソースも作成していない。

**P1の未解決リリース条件：** 読み取り期限は厳密に24hだが、物理削除はscheduler遅延・停止の影響を受ける。DBバックアップ/PITRにはciphertextが残り、共通鍵があれば復号できる。OpenAIの不正利用監視ログ、Vercel/Turnstileのログ保持も自サービスDBとは別である。厳密な本文保持24hを満たすには、バックアップから独立した期限付き鍵管理または同等の運用保証・外部事業者の保持設定が必要。現状を「24hで全コピーが消える」と保証せず、`TRIAL_RETENTION_VERIFIED=false`を維持する。

## AI利用ログの環境

既存の `src/lib/ai/run.ts`はis_test=true固定、`src/lib/consultation/ai.ts`は未指定時true。既存診断/決済を全面改修しないという範囲に従い変更しない。新機能は既存ログ表へ書かず、環境/brand必須の独立費用台帳を使う。将来Live対応は別migrationと環境確認を必要とする。Stripe環境チェックを回避する処理はない。

## 適用前チェックと復旧

1. 承認前には実DBへ適用しない。適用対象は `20261014151638_trial_foundation.sql` 1件だけ。
2. 既存ローカルの過去migration名は実DB履歴と時刻が異なる。過去ファイルの一括db push・repairをしない。実14件を読み取り取得した専用stageに承認済み新規1件のみを追加し、dry-runを確認する。
3. 実行直前に再度HEAD、Preview、14件履歴、決済件数/照合、RLS、payment_environment=sandboxを確認。新しいバックアップを取得し復元を確認。今回検証したバックアップ原本を上書きしない。
4. 有効化前の戻し方は、アプリの新branchを使わず安定版を維持すること。実DBへ適用した後も、まずTRIAL_ENABLED=falseとDB enabled=falseで停止する。既存購入データをrestoreで巻き戻さない。
5. 新schemaを削除する逆migrationはデータ消失を伴うため自動実行しない。会員へ保存済みの相談は保護する。整合性障害なら現状態を保全し、隔離DBへ復元して調査する。
6. 今回Dockerの合成データで全15migrationを適用し、旧1980円/980円・設定・RLSの不変、dump→別DB復元、期限削除を検証した。既存ユーザーデータを隔離試験へコピーしていない。

## Git/Preview

Vercel連携productionBranch=main。新branchの`vercel.json`に`codex/yorisoi-phase6-redesign:false`を追加。既存branchの無効設定も保持。CIにはデプロイ処理なし。push前後に固定Previewのdeployment ID・安定版SHAを比較する。

## 既知の検証限界

実OpenAI/Turnstile、メール送信・確認リンクを含む外部E2E、Stripe決済/返金/解約の新規実行、実機IME/VoiceOver、5名の利用者テストは未検証。自動テストの外部接続skipを成功に数えない。本文と出力の安全性・創作防止はpromptと構造検証だけで完全保証できず、実AIでの評価を有効化前に要する。
