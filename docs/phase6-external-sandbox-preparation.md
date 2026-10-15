# 第1開発単位：外部Sandbox構築・結合検証の承認前計画

調査日：2026-10-15（JST）。アプリ基準：`8869a23d8e1ec46a20fd55f015bd52916ce6e15a`、ブランチ：`codex/yorisoi-phase6-redesign`。

**今回は準備のみ。クラウド資源・鍵の作成、設定変更、SQL適用、メール送信、AI生成、テスト決済、デプロイは実施していない。** 読取調査、ローカル検証、文書のcommit/push/CIに限定する。第2開発単位は対象外。

## 1. 実アカウントで確認できた状態

| 対象             | 2026-10-15の読取結果                                                                                                                                               | 判断・未確認事項                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase         | 全所属組織一覧はAI Fortune（`xypcnfoznewknhiumsqd`）1件、plan=`free`。全プロジェクト一覧はpartner-mind（`rnvrdrfdbapfafwjbygo`）1件、ACTIVE_HEALTHY、東京、PG17.11 | 公称2 active枠から、確認できる空きは1枠。作成による最終クォータ判定は未実施・枠の予約なし                                                            |
| Supabase作成画面 | AI Fortune / Freeで新規作成フォームを閲覧でき、上限到達・有料変更要求は表示されなかった                                                                            | 入力・送信していない。`get_cost`はUNAVAILABLEで最終見積取得不可。Free維持・追加機能なしの費用は公表価格に基づく$0。作成直前に再確認し、0以外なら停止 |
| Supabase課金     | Free、Spend Cap有効、支払方法なし、請求書なし。超過時は追加請求ではなく停止・read onlyの可能性との表示                                                             | 同一組織の利用枠には共有項目がある。別DBでも既存環境へのクォータ影響はゼロとは断言しない                                                             |
| Supabase使用量   | Egress 0.04/5GB、DB 35/500MB、MAU 71/50,000、Storage 0/1GB                                                                                                         | 一時点の表示。新テストはDB100MB未満・Egress100MB未満・管理下アカウント2件を初期運用目安とし、80%到達前に中止。上限変更はしない                       |
| Supabase Cron    | 既存Freeプロジェクトの拡張一覧にpg_cron 1.6.4が利用候補として存在、未インストール                                                                                  | Freeで利用可能な構成。既存DBでは有効化しない。新DBでの有効化・job作成・実行は承認後                                                                  |
| Stripe           | ブラウザーで「AI Fortune テスト」`acct_1UNSvsIYwtQeIHKP`のSandbox表示を確認。980円単発、980円/月Plus、旧1980円の商品あり                                           | 既存Sandboxは検証データを保有。キー値は取得しない                                                                                                    |
| Stripe Webhook   | 固定Previewの`/api/webhooks/stripe`へ送る有効な送信先1件、11イベント。画面のエラー率表示27%（集計期間・原因は今回未調査）                                          | **既存Sandboxでのテスト取引は既存環境へ配送され得るため採用しない。** 既存送信先の停止・再送もしない                                                 |
| Stripeプラグイン | 利用可能接続はLive側AI Fortuneのみ                                                                                                                                 | Live API操作を行わず、Sandbox設定はブラウザーで閲覧。次回は専用SandboxのCLI/権限制限鍵を明示選択。Live接続を流用しない                               |
| OpenAI           | 現在選択中のPersonal組織にActiveのDefault project 1件。Standard Retention。専用テストprojectは表示されない                                                         | 全組織を横断した不存在の証明ではない。既存Defaultキーをコピーしない                                                                                  |
| OpenAI課金       | API残高$0.17、自動補充OFF。組織$100/月表示は「Limit not enforced」。gpt-6-luna利用枠表示あり                                                                       | $100は強制停止ではない。残高は共有・変動するため予算保証にしない。購入・補充・制限変更なし                                                           |
| Turnstile        | Cloudflareはログイン画面まで。ログイン操作・widget作成なし                                                                                                         | アカウント、既存widget数、空き枠、設定は未確認                                                                                                       |
| Vercel           | reviewプロジェクトはAll Deployments（`ssoProtection.deploymentType=all`）、Git未接続。Preview用7変数のみ、Production用0、外部サービス鍵名なし                      | コネクター403のため同一team/projectを明示した認証済CLIのGETで確認。値は復号しない。既存deployのplanはHobby                                           |

Freeの2枠は、Owner/Adminの全組織を通算し、停止中のプロジェクトを除く。現在取得できた一覧では1枠空きだが、作成時のサーバー判定まで保証はしない。[Supabase課金仕様](https://supabase.com/docs/guides/platform/billing-on-supabase)

## 2. 費用・制約

| サービス               | 作成・固定費の計画                                                           | 利用制限・追加費用の扱い                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase新Free project | $0（追加機能なし、無料枠1件利用の条件）                                      | DB500MB/project、Egress5GB、MAU50,000、Storage1GB。非活動1週間で停止。自動バックアップ/PITR/branchingなし。Proへの変更はしない                                                           |
| Auth標準メール         | 追加SMTP契約なしなら$0                                                       | 組織チームに登録された宛先のみ、現在2通/時、配送SLAなし。宛先不足を理由に組織権限を増やさない。必要なら専用SMTPを別見積・承認                                                            |
| Stripe専用Sandbox      | 実資金移動$0。Sandbox作成の追加契約費用は管理画面で未確定                    | 公開資料は最大5 Sandboxと実決済なしを明記。作成直前の料金表示・枠を再確認。課金条件があれば停止。実カード/Live鍵/有料アドオンは使わない                                                  |
| OpenAI専用project      | 作成料金よりAPI従量利用が対象。今回利用$0                                    | 第1段階：匿名相談最大20生成、承認予算$0.10、追加購入なしを提案。全33件は別予算。残高不足時は停止し、補充額を別承認                                                                       |
| Turnstile              | Free枠内$0見込み                                                             | Free20 widgets、各10hostnames、チャレンジ回数無制限。アカウント枠は未確認。Freeを確認できなければ作成しない                                                                              |
| Vercel別project        | Hobby適格かつ枠内なら$0。AuthenticationのAll Deployments自体に追加add-on不要 | Hobbyは個人・非商用限定。将来有料サービスの検証用途の適格性を確認し、適格と言い切れない段階で0円構築を確約しない。Proが必要なら$20/月から＋従量分を別承認。既存teamを勝手にupgradeしない |

今時点の**Supabaseの作成・月額見積は0円（$0）**。環境全体を必ず0円にできるとは未確定。外貨の円換算、税、追加SMTP、OpenAI入金、Vercel有料契約は別項目。作成が無料でもユーザーの作成承認は必要。

出典：[Supabase料金](https://supabase.com/pricing)、[SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[バックアップ](https://supabase.com/docs/guides/platform/backups)、[Stripe Sandbox管理](https://docs.stripe.com/sandboxes/dashboard/manage)、[Stripe Sandbox](https://docs.stripe.com/sandboxes)、[Turnstile料金](https://developers.cloudflare.com/turnstile/plans/)、[Vercel料金](https://vercel.com/pricing)、[Hobby利用条件](https://vercel.com/legal/terms)、[Vercel保護](https://vercel.com/docs/deployment-protection)。料金確認日2026-10-15。実行前に再確認する。

## 3. 推奨構成と作成対象

| 要素      | 新しい対象                                                  | 分離方法                                                                                        |
| --------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Supabase  | AI Fortune / `yorisoi-integration-test` / Free / 東京を優先 | project refは作成後に記録。新DB・Auth・専用キー。既存DBからのbranch/clone/データ・鍵コピー禁止  |
| Stripe    | `yorisoi-integration-test`という別Sandbox                   | 空から作成。既存設定のコピーを選ばない。新しいaccount ID、商品・価格・Portal・Webhookだけを使用 |
| OpenAI    | `yorisoi-integration-test`という専用project                 | gpt-6-luna限定、Standard、Responses・入力token計数だけ。既存Defaultへの課金を避ける             |
| Turnstile | `yorisoi-integration-test`の専用widget                      | 新Preview専用hostnameと`trial_session` action。既存widgetは変更しない                           |
| Vercel    | `yorisoi-integration-test`という別project                   | Git自動deployなし、Preview限定、All Deployments、noindex、独自/既存ドメイン割当なし             |

同じSupabase組織のFree projectを1件追加する案が、DB/Auth分離と費用の釣り合いがよい。既存partner-mind利用案は新SQL・Auth設定・清掃・復元の影響を隔離できず、今回の禁止条件にも合わない。組織まで別にすると管理負担が増え、個人のFree枠が増えるわけではない。まず同一組織内の独立DBで少数試験とし、共有クォータを監視する。

### 新DBへの適用手順（未実行）

1. 承認された組織・名称・Free・地域を作成直前に再表示。追加課金・枠不足なら停止。新refを記録し、既存ref `rnvrdrfdbapfafwjbygo`と異なることを確認する。
2. Git連携なし、DBは空、専用の強いDBパスワード。Data APIは必要だが、migrationが明示するGRANT/RLSだけを使う。作成画面の「Automatically expose new tables」は無効を計画し、16 SQLが実際に必要権限を付与することを別途確認する。自動RLS追加もmigrationとの差分を確認してから決める。
3. 下表の固定SHA・SHA256と照合して16 SQLを順番に適用。Supabase CLIのmigration履歴に記録。各SQLの既存transaction境界を守り、失敗時は残りを実行しない。resetやrepairで失敗を隠さない。
4. 新DBでも`trial_private.settings.enabled=false`を確認。新Stripe Sandbox IDが確定するまではAuthユーザー・diagnoses・payment fixturesを投入しない。13番SQLは旧Sandbox IDを初期値に持つため、**全16件適用後、空DBのままDB所有者権限で新IDへ初期化**する変更を別途承認対象に含める。
5. `price_versions`・service_settingsの価格とPortal IDは、新Sandboxで作ったIDにだけ差し替える。非activeのLive価格seedは有効化しない。`payment_environment.mode=sandbox`を維持する。
6. 合成fixtureをrun ID付きで投入：無料、Plus、旧1980円・新980円購入、診断・相手・履歴。認証メール対象A/Bと、メール不要のAPI品質試験用`example.invalid`ユーザーは区別する。既存データを取り込まない。
7. SQL 16件の履歴、RLS、RPC権限、所有権、disabled状態、価格IDの環境整合、Cron未設定状態を検査。外部実行開始には別の段階承認が必要。

移行順序とチェックサムは[移行manifest](phase6-external-migration-manifest.md)。13番の環境初期化・価格置換・Cron・fixtureは16 migrationsとは別の承認対象であり、元のmigrationファイルを書き換えて済ませない。

## 4. 必要なキーと設定

| 用途              | 設定名・保存場所                                                                                                                                                  | 取得・検証の条件                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB/ブラウザーAuth | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`                                                                                                       | 新projectだけ。現行コードに合わせanon互換キー。publishable鍵へ変更するなら互換確認を追加                                                                                                 |
| DBサーバー処理    | `SUPABASE_SERVICE_ROLE_KEY`                                                                                                                                       | 新projectだけ、PreviewのSensitive/Secret設定。ブラウザー公開禁止。DDL用DBパスワード/PATはVercelに置かず、承認された作業端末だけ                                                          |
| アプリ認証        | `SESSION_SECRET`、`NEXT_PUBLIC_APP_URL`、`AUTH_EMAIL_MODE=standard`                                                                                               | 新秘密を生成。URLは結合検証の正確な保護付きPreview。Auth Site URL/Redirect allowlistも同じURL、ワイルドカードなし                                                                        |
| 匿名相談          | `TRIAL_SESSION_SECRET`、`TRIAL_ABUSE_SECRET`、`TRIAL_ENCRYPTION_KEY`、`TRIAL_CLEANUP_SECRET`                                                                      | 新生成。暗号鍵は32bytes/base64。バックアップと別保管、削除担当・期限を承認。旧デモへ設定禁止                                                                                             |
| OpenAI匿名        | `TRIAL_OPENAI_API_KEY`、`TRIAL_OPENAI_PROJECT_ID`                                                                                                                 | 専用projectの権限制限service-account key。project scopeをAPI要求と照合。管理/請求キーをアプリへ渡さない                                                                                  |
| 既存AI33件        | `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_CHAT_MODEL`                                                                                                             | 承認後だけ同じ専用project内の試験用キー。匿名用とキーを分けてusage分類。モデル/単価を実行前に固定                                                                                        |
| Stripe            | `STRIPE_SECRET_KEY`（`rk_test_`優先）、`STRIPE_ACCOUNT_ID`、`STRIPE_WEBHOOK_SECRET`、必要時`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`STRIPE_PAID_DIAGNOSIS_PRICE_ID` | 新Sandboxのみ。Customer、Checkout、Subscription、Invoice、Portal、必要時Test Clock/Eventの最小権限。Webhook secretは送信先ごとに別。key prefixだけでなくaccount IDとlivemode=falseを確認 |
| Turnstile         | `NEXT_PUBLIC_TRIAL_TURNSTILE_SITE_KEY`、`TRIAL_TURNSTILE_SECRET`                                                                                                  | 専用widget。管理tokenは端末限定。ブラウザーに出してよいのはsitekeyだけ                                                                                                                   |
| メール/その他     | `MAIL_ENABLED=false`、Resend/GAキーなし、必要時`CRON_SECRET`                                                                                                      | Auth標準メールとアプリ問い合わせメールは別。不要な自動メール・分析送信を無効のまま維持                                                                                                   |

初期値は`TRIAL_ENABLED=false`、`TRIAL_RETENTION_VERIFIED=false`、`TRIAL_BUDGET_VERIFIED=false`、`TRIAL_ENVIRONMENT=sandbox`、`PUBLIC_INDEXING_ENABLED=false`、`STRIPE_MODE=sandbox`、`STRIPE_LIVE_CHECKOUT_ENABLED=false`、`PREVIEW_DEMO_ENABLED=false`。匿名機能のDB側もOFF。Vercelのシステム環境変数は偽装せず実値を確認する。

キー・JWT・メールリンク・Cookie・相談本文を報告書、CIログ、Git、チャットへ記載しない。承認後の外部試験は専用作業ディレクトリと専用環境ファイルで行い、通常CIには実キーを追加しない。利用プラグインはSupabase、Stripe、Vercel、Computer Use。OpenAIは公式Docsと管理画面、Cloudflareは管理画面（専用接続なし）。

## 5. 実認証テストとメール計画

**宛先A/Bは未指定。所有者と組織チーム登録を確認してから、実行前に正確な2宛先・最大4通を承認してもらう。** 現在のブラウザーのログインメールを送信承認と見なさない。標準SMTPで両宛先を使えない場合は止め、専用SMTPの費用・送信ドメイン・許可先を提示する。メールのためだけに既存組織へ強い権限を持つメンバーを追加しない。

送信案：最初の時間枠にA登録1通・B登録1通。次の制限解除後にBの確認再送1通・Aのパスワード再設定1通。自動再試行なし、合計最大4通。Bは未確認の間に拒否を検証し、その後に確認する。429なら制限時間を待ち、通数を増やす場合は再承認。SMTPを設定しても本計画の最大通数は増やさない。

| 順  | 実操作と期待値                                                                                                        | 書込み・証拠                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A1  | A/B新規登録、確認メール送信。登録直後を認証成功と扱わない                                                             | 新Authユーザー・rate limit記録・メール。旧DBへアクセスしない                                      |
| A2  | B未確認でログイン/引継ぎ拒否。A同一ブラウザーで確認、Bは再送後に確認                                                  | `email_confirmed_at`、SSO通過後もcallbackが正しく戻ること                                         |
| A3  | 正/誤パスワードのlogin、logout後のCookie消去、別ブラウザーでlogin                                                     | `/api/auth`を通す。Auth adminで確認済みにする操作をメール確認の代わりにしない                     |
| A4  | access token期限後のrefresh、refresh tokenローテーション、logoutしたsessionの更新拒否                                 | 実Authを使う。ログへtokenを出さず時刻・状態・匿名化IDを記録                                       |
| A5  | A再設定リンク→password更新→global signout、旧sessionでの操作拒否、再login                                             | 新projectのAだけ変更。JWT即時失効を想定せず、旧JWTの期限までと期限後の挙動を別測定                |
| A6  | PKCE確認リンクを別ブラウザーで開く失敗、token-hash方式で別ブラウザー確認しても現在ブラウザーの相談が自動claimされない | 認証方式を分けて実装の意図を確認。コード/リンク再使用拒否も確認                                   |
| A7  | 本人Cookie＋確認済みAで匿名相談をclaim、同じclaim再送は同じthread、2利用者の同時claimは1人だけ                        | **匿名機能の別承認後**。新DBの合成相談のみ。費用発生を分けるため保存済み合成回答fixtureも使用可能 |
| A8  | B/偽Cookie/期限切れCookieでAの相談の取得・削除・claim拒否。削除とclaim、期限切れとclaimの競合                         | RLS直接RESTと実HTTP両方。Aの履歴1件、Bに0件、無料3/Plus30利用枠が余分に減らない                   |
| A9  | 同じ匿名相談の重複引継ぎ、他メールの既存診断、別の相手の記憶混入を拒否                                                | syntheticのrun IDでbefore/after比較。クリーンアップもこのrunのIDだけ                              |

Freeでは単一session制限・有料の時間制限機能を前提にしない。通常のJWT満了・refresh・signoutで検証する。Auth監査ログ保持が短いため、その場で秘密なしの結果を記録する。[Auth sessions](https://supabase.com/docs/guides/auth/sessions)

## 6. Stripe・OpenAI・Turnstileの試験手順

### Stripe

別Sandboxを空から作り、980円単発/980円月額の新Price、旧1980円の合成購入fixture、Portal設定を用意する。既存Sandboxへの新顧客・価格・取引追加は禁止のまま。最初はmetadata/account/livemode/価格金額を読取検査し、その後に承認されたテストカードで購入、更新、失敗、解約、再契約、Webhook署名・重複・順序逆転を確認する。

`subscription-live.test.ts`はSandbox決済、Test Clock、支払手段、Portal session、DB書込を行う。現状の固定Preview return_urlを新URLへ変更し、対象チェック・失敗時cleanup・専用作業出力先を追加するまで実行しない。自作署名でのWebhook POSTと、Stripeからの実配送は別の検証である。

All Deploymentsを解除しない。初期のWebhook結合は新SandboxのStripe CLI→ローカル隔離アプリで検査。Vercel配送は署名検証に加えて認証保護を通す承認済み経路が必要。Automation bypassを使うなら対象・保持期間・ログ非露出を事前レビューする。URLへ鍵を入れる案を無条件に採用しない。既存送信先は操作しない。

### OpenAI

専用projectの月次hard spend limitを第1段階$0.10（UI最小値が対応する場合）へ設定し、50%/80%通知、低RPM、並列1、gpt-6-lunaだけ許可する計画。設定が単なるalertだった場合、または最小値が大きい場合は生成前に停止し、代案を承認してもらう。既存組織全体の上限は変更しない。projectの残高は組織共有なので、既存利用により不足した場合も自動入金しない。

20回は総計の上限案であり、1つのIPで即日20回を通す計画ではない。既存のIP成功3回/日などの制限を維持し、日程を分ける。外部試験のためにIPヘッダーを偽装したり制限を緩めたりしない。

匿名相談は入力3000・出力1200上限、Standardの保守的入力$0.125/M・出力$0.50/Mで1回約$0.000975、20回約$0.0195。推定に2倍余裕をみても約$0.039。これは価格条件どおりのモデル使用量だけの見積りで、請求の絶対上限ではない。token countへの問い合わせ・失敗時usage・tier・税・価格変更も確認する。[モデル料金](https://developers.openai.com/api/docs/models/gpt-6-luna)

**外部33件のうち32件は既存診断・相談系の生成試験で、匿名相談の日3ドル予約台帳を通らない。** consultation28件は通常28～56生成、editorial1件は10相談を内部反復して最大数百呼出、backfillは対象行数次第。まず匿名20生成だけを独立承認し、33件は対象数・モデル・入力見積・再試行回数の確定後、別予算で承認する。以前の「20回・1ドル」は全33件の見積ではない。

記録を2帳に分ける：アプリ側はrun ID、project、model/tier、request ID、入力/キャッシュ/出力token、予約・確定・推定USD、価格version/期限。外部側はOpenAI Usage/Costsのproject別集計・確定請求・期間UTC・取得時刻。反映遅延分は未確定として残し、一致を確認するまで次のbatchへ進まない。プロンプト本文・鍵は記録しない。

価格seedの期限は**2026-10-22 00:00 JST**。期限切れ時はOFFのまま価格を再確認し、新DBの価格更新を承認対象にする。store=falseとStandard Retentionは完全即時削除を意味しない。3ドル/日はアプリ制御であり、OpenAI側hard limitにも反映遅延があるため、外部請求までの絶対保証はしない。[Spend limits](https://developers.openai.com/api/docs/guides/spend-limits)

### Turnstile

ログイン後にアカウント/Free/既存数を読み取り確認し、承認後に専用widgetを作る。Managed、結合検証URLの正確なhostname、action=`trial_session`。hostnameが変わるdeployはallowlist再承認の対象。全hostname許可にしない。success、欠落、不正、5分期限切れ、再使用、異hostname/action、Siteverify障害を試す。Siteverifyへの送信自体も外部試験承認後。ダミーキーの固定hostname/actionに合わせて本体検証を緩めない。[Siteverify仕様](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## 7. Vercel構築・既存デモ防御

現在の復旧先を維持する（今回GETでREADYを確認）：

- デモ：`dpl_sgWrjpXYPRYwsjSBMjbBURJBRV76`、SHA `1d1bb223eaa466b258e227a4db8f1eee3b839443`、[rndnsy57p](https://yorisoi-phase6-review-rndnsy57p-vdiordna-2059.vercel.app/)、aliasなし。
- デモ以前の画面Preview：`dpl_3BUcNvhoRJXwYSTVv6TKZa5NhChY`、SHA `b723dedcebc136d30d8f5fe5614d9d429cf29d86`、[fg3fuf0tc](https://yorisoi-phase6-review-fg3fuf0tc-vdiordna-2059.vercel.app/)、aliasなし。
- 既存固定URL：[partner-mind](https://partner-mind-vdiordna-2059.vercel.app/)。過去記録のdeployment `dpl_HyY9XTTRhzoFv4uMXN7M6uRFTcwb`もREADY。固定aliasの再割当は行わない。

APIの通常Previewの`target`は`null`表現だった。`oidcTokenClaims.environment=preview`とprojectのpreview targetに属することを併記する。`null`だけでProductionではないと判定しない。新環境ではCLI `--target=preview`を明示し、実際のdeployment target/環境メタデータも確認する。

構築の承認後も、まず鍵なし静的ダミーで分類と保護を確認する。**新projectの初回がProductionになる可能性があり、この新projectのProductionダミーは未承認。** API事前条件でPreview分類を保証できない場合はデプロイ前に停止し、初回ダミーの別承認かVercel側の対応を求める。過去のreviewプロジェクト限定承認を流用しない。予期せぬProduction分類が返ったら本体/鍵を送らず停止・報告する。

Preview成功後、未認証の固有URL・自動alias・既定ドメインで内容が見えないこと、認証後のnoindex/header/robots、Git自動deployなし、Production env 0を確認してから新Previewへ接続する。`--skip-domain`を使う場合も実aliasを確認し、既存2URLのalias変更・promotionは行わない。Previewのみの鍵でもビルド時利用はあり得るため、build設定/ログも確認する。

8869a23dのソースではreview ID `prj_oBNCS3yHBdYmvCuSKC4pnhcoypp6`に対し、デモOFF/欠落/Production誤分類でもproxyが503、匿名runtimeも拒否する。通常プロジェクト処理は従来のまま。今回関連3ファイルの自動テスト127件成功。前回HTTPシナリオ16でも実SDK到達前遮断を確認済み。**現行デモは1d1bb223のままで、この追加防御は未反映。** 今回はデプロイしない。次回反映時は新しい保護付きPreviewを作る承認を得て、rndnsy57pを復旧先として残す。プロジェクト設定のenv名一覧に外部鍵がないことも今回確認したが、値の抽出・新しい鍵の追加はしない。

## 8. 清掃・停止・復旧

新DBにだけpg_cronを有効化し、5分ごとに`trial_cleanup()`、実行履歴`cron.job_run_details`と`trial_health()`のheartbeatを監視する設計。最小権限の専用清掃roleと監視roleを新DBで検証し、既存service roleキーをjob本文へ埋め込まない。job履歴も保存期間を設け、本文をログへ出さない。Free休止中にCronが動くことは期待しない。Vercel Preview Cronには依存しない。

初期試験は担当者が開始前・各batch後・終了時に確認。無人運用を始める前に、DBの外から5分間隔で監視する実行場所と通知先（未定）を承認する。清掃失敗/heartbeat10分超で新規生成停止を確認。cronが戻っても自動でONにしない。[Cron仕様](https://supabase.com/docs/guides/cron)

| 検知条件                                                               | 停止                                                                                         | 復旧条件                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| ref/account/project/hostnameの不一致、Live鍵、Production分類、保護なし | 次の書込みを中止。新環境だけを閉じ、許可済みの停止手順を実施。既存環境の設定は触らない       | 対象と原因を報告、再承認。Productionでの本体再試行なし                          |
| 予算超過見込み、usage不明、価格期限切れ、OpenAI429/残高不足            | trial DB enabled=false＋アプリOFF、必要なら新project専用キー失効。進行中要求の費用は予約維持 | 外部請求と台帳照合、価格再確認。上限引上げ・入金は別承認                        |
| Auth送信超過、未承認宛先、SMTP異常                                     | 送信・再送を止める。token/メール本文をログに出さない                                         | 配送数と宛先を照合、追加通数を承認                                              |
| Stripe異常・他環境への配送                                             | 新Sandboxの試験と新Webhook配送を停止。既存送信先は変更しない                                 | run ID単位の取引・イベント・DB整合を確認。再送/返金も承認範囲内だけ             |
| Cron/DB障害                                                            | 新規匿名相談停止、閲覧期限は延長しない                                                       | 清掃の成功、権限・所有権・費用を再確認して手動再承認                            |
| migration失敗                                                          | 残りを適用せず、到達version/エラーを記録。partial状態でアプリ接続しない                      | 原則、合成データしかない新DBを承認済み手順で再構築。既存DBのrestore/resetは禁止 |

Freeの復旧は自動バックアップに依存しない。16 migrations＋合成fixture＋環境設定台帳を再生成元にする。試験開始前の新DBだけを暗号化してローカルexportし、原則7日で削除する案。保存先は権限制限された作業端末、担当は実行担当者。保存期限/担当/削除の承認が必要。StorageオブジェクトやAuth・鍵・provider設定がDB dumpだけで完全復元されるとは扱わない。実メール検証ユーザーは再登録を基本にし、セッションの継続を復元成功条件にしない。

復元試験はまず追加Free枠を消費しないDockerで行う。クラウド復元は新テストproject内だけに限定し別承認。外向き通信・生成・Webhookを閉じて復元し、**期限内も含め匿名セッションを全削除**してから再公開する。外部に控えた費用記録で古い台帳への巻戻りを検知し、二重予算使用を防ぐ。バックアップ/WAL/providerログを含む24時間以内の完全消去は保証しない。

## 9. 外部33件と品質検証

[33件の接続先・書込・実行条件対応表](phase6-external-test-matrix.md)を参照。全33件は今回も**未検証**。同表は既存6ファイルを静的に追跡したもので、Auth実メールや匿名API外部結合の代用ではない。

基準8869a23dの484件・HTTP16件は変更しない。今回の変更は文書のみ。デモ防御の関連127件をローカルで再確認済み。文書push後のCIでlint・型・484テスト・Nextビルド・Docker/HTTP16件を再確認し、結果は完了報告に記録する。外部テストをONにするenvや実キーをCIへ渡さず、33件のskipを外部成功と数えない。

## 10. 次に必要な承認（未承認のまま）

| 段階 | 承認対象・上限                                                                                              | 費用/開始条件                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| P1   | Supabase `yorisoi-integration-test` 1件作成、Free、東京優先                                                 | $0を作成直前に確認。0でも明示承認後。新ref取得後、SQL対象照合                                                |
| P2   | 新refへmanifest16件、空DBのStripe環境初期化・専用価格、合成fixture、Cron、暗号化export/復元/cleanup         | 新DB限定。DB/鍵保持7日案、担当・監視先も確定。新Stripe account ID確定前にユーザーを入れない                  |
| P3   | Auth設定と実認証、所有する2宛先へ最大4通                                                                    | 宛先実名・チーム適格性の承認。SMTP追加契約なら別費用承認                                                     |
| P4   | 別Stripe Sandbox作成、新商品/価格/Portal/送信先/RAK、試験IDを指定したテスト取引・Test Clock・解約と後片付け | 実資金$0、作成費用と枠を事前再確認。既存Sandboxは対象外                                                      |
| P5   | OpenAI専用project/key・モデル/RPM・hard limit、匿名生成最大20回・予算$0.10                                  | 現残高のみ、補充なし。利用可能な最小hard limitと実単価を確認。既存32件のAI品質試験は別予算承認               |
| P6   | Cloudflareログイン後の枠確認と専用Turnstile widget作成/検証                                                 | Free内$0条件。正確なhostname指定                                                                             |
| P7   | 新Vercelproject/保護/Preview配備/Previewだけの鍵、noindex、Webhookの保護通過方法                            | Hobby適格性未確定。Pro必要時$20/月から別承認。Production初回が必要ならダミー限定の別承認、本体Production不可 |
| P8   | 外部匿名機能のDB設定と3フラグの段階的有効化・停止訓練                                                       | 新結合検証環境だけ。保持/価格/監視/予算の証拠を満たしてから。現在のデモは常にOFF                             |
| P9   | デモOFF防御を反映する新Preview                                                                              | review projectの鍵なし構成を維持し、現行デモURLを保存。今回は未デプロイ                                      |

準備完了で停止する。作成、SQL、メール、決済、AI、Turnstile、Vercelの承認をまとめて得たと推測しない。main/Production/第2開発単位へ進まない。
