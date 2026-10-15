# フェーズ6 第1開発単位 結合検証と外部Sandbox計画

2026年10月15日。対象は `codex/yorisoi-phase6-redesign`、開始時コミット `1d1bb223eaa466b258e227a4db8f1eee3b839443`。第2開発単位は対象外。

今回の結合検証はローカルDockerの合成データだけで実施した。既存Supabase、Stripe、OpenAI、Turnstileの実アカウントへの接続試験は実施していない。GitHubへのpushとCI、公開ドキュメント・コンテナイメージの取得は検証作業に含む。現在のデモPreviewと固定Previewへのデプロイ・設定変更は行わない。

## 結果と修正

- 既存14件、新SQL `20261014151638_trial_foundation.sql`、`20261014160317_trial_safety_hardening.sql` を順に適用。全16件成功。SQL本体は変更していない。
- PostgreSQL 17.11、PostgREST 13.0.0、実際のNext.js HTTPルート、実際のSupabase SDKを結合した。外部Authの `getUser`、Turnstile、OpenAIだけをプロセス起動時の試験専用モックで置き換えた。
- 署名付き合成JWT、実際のSSR Cookie処理、PostgRESTのJWT検証・RLS、DBのメール確認済みフラグを試験した。Supabase Authサーバー自体、メール配信・メールリンクの消費、トークン更新・失効は未検証。
- 通常の自動テスト484件成功（既存459件と追加25件）。外部接続33件は従来どおり未実行。別に実HTTP結合16シナリオ、Docker SQLの競合・復元検証が成功。これらを単純合算して単体テスト数とは表示しない。
- lint、型チェック、Next.jsビルド成功。GitHub CIにDocker HTTP結合試験を追加。CI結果とコミットは完了報告で提示する。

実HTTP試験で、不正な回答形式に対してOpenAI SDKの `responses.parse()` が回答の検証を先に行い、受信済みのusageを呼び出し側で取得できなくなる問題を検出した。匿名相談専用の共通処理を `responses.create()` → usage確認 → JSONとschema検証の順序に変更した。不正回答・不正JSONでも実測usageを記帳し、成功利用枠は消費しない。通信結果不明時は予約費用を残す。既存の診断・継続相談用生成処理は変更していない。

検証専用VercelプロジェクトIDに対して、デモ設定がOFF・欠落・Production誤分類の場合も画面とAPIを503で遮断する防御を追加した。匿名相談の起動条件にも同じ拒否条件を追加した。通常プロジェクトの経路は従来どおり。**この防御は今回のコードとローカルHTTPで確認したもので、現在公開済みのデモPreviewには未反映**。現在のデモPreviewは受領済みの構成（デモON、実接続鍵なし、匿名AI OFF）のまま保持する。外部サービス接続禁止に従い、クラウド設定の再取得は今回していない。

## 試験対応表

| 対象 | 検証結果 |
| --- | --- |
| 匿名セッション | 実HTTPで発行。Secure、HttpOnly、SameSite Strict、Path、Max Age 86400を確認。Cookieのブラウザーによる強制は今回の対象外 |
| 暗号化と読み取り | DB本文・回答は平文を含まない。APIで復号、更新後も保存済み回答を取得。改ざん・別セッションAAD拒否は既存自動テスト |
| 24時間 | 発行時の期限差を確認。DB時刻を期限切れに進め、読取・送信・引継ぎを拒否。実時間24時間の待機試験ではない |
| 費用予約と同時送信 | 同一セッション12並列で予約・AI呼び出し1件。重複の再送は保存済み回答を返す。本文の変更は409 |
| 3ドル予算 | DB20並列、合成高単価で最大3予約。計上額2.9289625ドルで3ドル以下。HTTP10並列でも余分な生成を拒否 |
| 失敗費用 | 送信前失敗は予約解除、送信後不明は予約維持。不正回答でもusage記帳。価格期限切れ・モデル異常は停止 |
| 本人削除 | 本文削除、繰り返し削除、利用枠を戻さないことを確認 |
| 引継ぎ | 未認証・未確認メール・偽署名・表示メール不一致を拒否。2アカウント競合で一方だけ成功。再送は同じ相談ID |
| 他人の情報 | 独立・偽Cookieによる取得・削除・引継ぎで本人データを取得しない。他会員の相談履歴は404、直接RESTのRLSも拒否 |
| 会員履歴・無料・Plus | 所有者の履歴に1件保存。無料3回・Plus30回の枠を減らさない。1980円・980円購入、Plus契約の合成行が変化しない |
| 定期削除 | 清掃APIの認証、期限切れ削除、10分超のheartbeat停止、復旧後も自動で有効化しないことを確認。クラウドスケジュールは未設定 |
| 競合 | 削除と引継ぎ、清掃と遅延費用確定、生成中の期限切れ・削除で本文が復活しない |
| DB権限 | 匿名相談関連8テーブルのRLS、11 RPC × 2ブラウザーロールの実行権限なし。直接REST書込拒否 |
| DB障害 | PostgREST停止で503、追加AI生成なし |
| バックアップ | 合成DBをpg_dumpし、ACLを含め別DBへ復元。停止状態にして清掃、既存購入・Plus・費用台帳とRPC権限を再確認 |
| デモOFF | 接続設定が存在する合成条件でも、検証専用プロジェクトの実HTTPは503。DB呼出回数が増えない |
| ログ | Nextプロセスログに合成本文・メール・各鍵・JWTが含まれないことを確認。プロバイダーの実ログは未検証 |

## 再現方法と境界

Node.js 24、Python 3、Docker、プロジェクトの依存関係が必要。`npm run build` の後に `npm run test:integration` を実行する。結果JSONの保存先は `PHASE6_REPORT_PATH` で指定できる。CIでも同じ手順を実行する。

ハーネスは既存環境変数をNextサーバーへ引き継がず、合成鍵を実行ごとに生成する。試験用認証やモック設定はアプリのコードへ組み込まない。外部URLはモック以外を拒否し、Nextのソケットはループバックだけを許可する。DBは専用内部ネットワーク内でホスト向けポートを持たない。PostgRESTだけを127.0.0.1の動的ポートに公開する。公開に必要な別Dockerネットワークには外向き経路があるが、PostgRESTの接続先は専用DBのみである。

DBのtrust接続はこの使い捨て内部ネットワーク限定の試験設定であり、外部Sandboxへ転用しない。通常終了・例外終了時は今回のコンテナ、ネットワーク、一時鍵・合成データを削除する。強制終了時は `yorisoi-integration-` 接頭辞の今回の資源だけを確認して後片付けする。他のコンテナには触れない。

## 残存する制約

1. 外部接続33件、Supabase Authの実認証、Stripe SandboxのWebhook配信、OpenAIの実usage・請求との照合、実Turnstile、Vercel実行環境は未検証。ローカル成功を外部結合成功とはしない。
2. 閲覧期限24時間と、バックアップを含む完全消去は異なる。今回の復元試験は論理削除と権限の保持を検証した。物理バックアップ・WAL・プロバイダーログの24時間以内の消去は保証しない。
3. 復元したバックアップは削除前の本文を含み得る。外部環境の復元時はネットワークと生成を閉じ、**期限に関係なく匿名セッションを全削除してから**再公開する。会員へ引継ぎ済みの履歴は別の保存対象。DB外に保存した請求情報との照合が済むまでAIを再開しない。古い台帳への巻戻りによる二重予算使用を防ぐ。
4. バックアップ・鍵の保管先、保持期限、削除と復元の担当者、復元時の費用照合、監視通知先を外部テスト前に決める。期限切れ清掃は実行済みだが、外部運用の監視と定期実行を承認・設定する必要がある。
5. 3ドルはアプリの予約台帳で制御している。別キーからの利用、価格・課金分類の変更、計上遅延、未知のプロバイダー挙動まで含む絶対保証ではない。専用OpenAIプロジェクト、最小権限キー、モデル制限、低いレート制限、usageと請求照合を併用する。月次hard spend limitも伝播遅延により少額超過し得る。[OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits)

## 外部Sandboxの推奨構成

**独立したSupabaseテストプロジェクトと、現在のデモとは別のVercel結合検証プロジェクトを推奨する。** 合成データだけを新規作成し、既存Sandboxからデータ・鍵をコピーしない。無料枠の空きと利用条件を承認後に確認し、料金が発生する場合は作成前に見積りを提示する。

| 比較 | 既存Supabase Sandboxを使う | 独立したテストプロジェクト |
| --- | --- | --- |
| 安全性 | Auth設定、migration、清掃、顧客・決済のひも付けが他の検証に影響する | DB・Auth・鍵・清掃・復元を分離できる |
| 費用 | 追加インスタンス費用を避けられる可能性 | Free枠があれば0ドル。なければ追加料金の承認が必要 |
| 管理負担 | 初期準備は少ないが、衝突回避・復元・共有調整が必要 | 初期設定は増えるが、合成データの再作成と廃棄が容易 |
| 今回の制約との整合 | 既存実DBへの新SQL適用が禁止されているため、そのまま実施できない | 新規テスト環境への適用を別途承認後に限定できる |

Supabase Freeは500MB DB、2 active projects上限、1週間非活動で停止、定期バックアップは含まない。Proは月25ドルから、追加Microは月10ドル相当からで時間課金。既存契約・空き枠は今回照会していない。既存データ入りDBのbranchやcloneは採用しない。[Supabase料金](https://supabase.com/pricing)

## サービス別の設定と承認範囲

| サービス | 必要な設定とキー | 利用手段 | 合成データ・承認が必要な書込み | 費用と既存環境への影響 |
| --- | --- | --- | --- | --- |
| SupabaseテストDB | 別project ref、URL、publishableまたは互換anonキー、サーバー専用service role、migration用接続情報。新16 SQLを順に適用 | Supabaseプラグイン、CLI | 新DBへのmigration、fixture、清掃job、復元用DB。payment_environmentはユーザー投入前の空DBで新Stripe Sandboxのaccount IDへ初期化 | Free空きなら0ドル。既存DBは変更しない |
| Supabase Auth | メール確認ON、検証用URLだけをRedirect allowlist、期限短め、ブラウザー用公開キー | Supabaseプラグイン、ブラウザー | 管理できるテスト利用者A/Bと未確認ユーザー、signup、確認、login、logout、失効・別端末、引継ぎ競合 | Free枠内想定。別Auth領域に限定 |
| テストメール | 自分が管理する宛先だけ。まず既存チーム宛て標準SMTP、件数不足なら専用SMTP。SMTPパスワードはサーバー限定 | Supabaseプラグイン、管理画面 | テスト確認メール送信、期限切れ・再使用・誤ったリンクの試験。第三者へ送らない | 標準SMTPは2通/時、チーム外宛て不可。追加SMTP費用は契約未確認のため別承認 |
| Stripe Sandbox | 独立Sandbox、`rk_test_`の最小権限、account ID、テスト商品・価格、`whsec_`。Live鍵なし | Stripeプラグイン、CLI | 顧客・980円単発・980円Plus・旧1980円合成購入、テストCheckout、契約更新・解約・失敗・重複Webhook。テスト支払・返金も別途承認対象 | 実資金移動なし。追加契約料金は実行前に確認。既存Sandbox・Live設定は変更しない |
| OpenAI | 専用test project、期限付きサービスアカウントキー、Responsesとtoken countのみ、モデルgpt-6-luna、store false、低RPM、月次hard limitと通知 | OpenAI Docs、管理画面、SDK。利用可能ならOpenAI Developersプラグイン | 承認済み合成文だけで最大20回答。usage、request ID、料金、失敗時費用を照合。プロンプト本文をアプリログに保存しない | 従量課金。まず試験費用上限1ドルを承認対象にする。現在のdemoには追加しない |
| Cloudflare Turnstile | 検証専用widgetの公開sitekeyと秘密key、正確なPreview hostname、action=trial_session | ブラウザー、Cloudflare API（専用プラグインは未接続） | widget作成、成功・失敗・再利用・期限切れ・異hostname。既存widgetを変更しない | Freeは20 widgets、各10hostnamesまで。空き・条件は実行前確認 |
| Vercel結合検証 | 別project、All Deployments、noindex、Preview target、鍵はPreview限定。デモproject IDは実API拒否のまま | Vercelプラグイン、CLI、ブラウザー | 新規project・初回分類の確認・Preview配備・必要env設定。Production本体は禁止 | All DeploymentsのVercel Authenticationは有料add-on不要。利用枠・プラン適格性は実行前確認。既存Preview不変 |

[Supabase SMTP制約](https://supabase.com/docs/guides/auth/auth-smtp)、[Stripe Sandboxes](https://docs.stripe.com/sandboxes)、[Stripeキー管理](https://docs.stripe.com/keys-best-practices)、[Turnstile Free](https://developers.cloudflare.com/turnstile/plans/)、[Vercelアクセス保護](https://vercel.com/docs/deployment-protection)を前提とする。実サービスのアカウント固有の料金・権限は未照会。

OpenAIの参考試算は、入力最大3000・出力最大1200、入力をcache write上限0.125ドル/100万token、出力0.50ドル/100万tokenとして、1回答0.000975ドル、20回答約0.0195ドル。これはモデル使用量だけの見積りであり、最低入金額・税・追加の試験・請求分類の変更は含まない。実行前に価格の有効期限を更新する承認と、口座条件の確認が必要。価格期限を黙って延長しない。[OpenAI pricing](https://developers.openai.com/api/docs/pricing)

Turnstileのダミーキーは固定のhostname/actionを返す場合があり、アプリの厳格な検査を満たさない。外部結合では専用widgetと実hostnameを使い、テストのためにhostname/action検証を緩めない。[Turnstileテスト仕様](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)

## 清掃と監視の外部試験

独立テストDB内のSupabase Cronで5分ごとに `trial_cleanup()` を実行し、実行履歴と `trial_health()` を監視する案を推奨する。清掃用の最小権限ロールと接続先を固定し、本文をログに含めない。10分超の未実行ではアプリが新規相談を拒否し、清掃復旧後も手動で承認するまでenabledを戻さない。失敗通知の経路・宛先は別途指定する。[Supabase Cron](https://supabase.com/docs/guides/cron)

Vercel Previewの標準Cronには依存しない。HobbyのCronは1日1回が最短で、この監視要件を満たさない。[Vercel Cron料金と制限](https://vercel.com/docs/cron-jobs/usage-and-pricing)

All Deploymentsを維持したままStripeのWebhook配送を試すには、署名検証に加えて保護を通過する配送経路が必要。初期段階はStripe CLIでローカルの隔離アプリに転送する。Vercel上への配送は、限定した検証先への短期間のAutomation bypass等を別承認とし、保護全体をOFFにしない。URLに秘密を埋め込む案はログ漏えいの確認なしでは採用しない。

## 次工程で必要な承認

1. 独立Supabaseテスト環境の作成、空DBへの16 migrations適用、合成データ・Auth設定・清掃job・バックアップ復元試験。既存DBへの許可ではない。
2. テストメールの宛先と件数、signup・確認・login・logout、合成アカウントの後片付け。
3. 独立Stripe Sandboxの作成または専用の既存Sandbox指定、テスト商品・顧客・契約・Webhook、テスト決済・返金の具体的なケース。
4. OpenAI専用project・キー・費用上限、合成データによる有料生成の最大回数。現在のデモでは匿名AIをONにしない。外部結合専用環境の段階的な有効化は別承認。
5. Turnstile widget、別Vercel検証projectとPreview配備、Preview限定の接続鍵、監視通知先と保護付きWebhook配送方法。
6. 無料枠不足・プラン変更・SMTP・その他の追加費用が判明した場合、その金額の承認。今回の作業では新規有料リソースを作成していない。
7. 今回のデモOFF防御を既存デモへ反映する場合は、別の保護付きPreviewを作る承認。現在の正常なデモURLは復旧用として保持する。

承認後も、最初は認証・保存だけを検証し、AI・決済は各ケースの明示承認後に進める。33件の外部テストは一括で無条件実行せず、対象環境と書込範囲を確認してケースごとに対応づける。Supabaseの2026年11月10日以降の旧TLS暗号廃止に備え、検証では現行NodeとTLSを使用する。[Supabase変更告知](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)
