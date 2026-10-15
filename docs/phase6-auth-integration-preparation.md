# Phase 6 STEP 5：実Auth・メール認証の結合検証準備

確認日：2026-10-16（JST）。対象は `ukdzggjfkcwjssjmnqim` のみ。
**今回は準備まで。実ユーザー作成・メール送信・設定変更・外部生成・決済・デプロイは未実施。**

## 1. 実設定の読み取り結果

Supabase Dashboardの新プロジェクトのAuth画面とSupabase MCPの読み取りSQLで確認。秘密鍵は取得・記録していない。

| 項目 | 現在値 |
|---|---|
| 組織・プラン・地域 | AI Fortune / Free / ap-northeast-1 |
| DB状態 | ACTIVE_HEALTHY、PostgreSQL 17.11 |
| メールプロバイダー・新規登録 | 有効 |
| Confirm email | ON（自動認証ではない） |
| Anonymous sign-ins / Manual linking | OFF / OFF |
| Site URL | `http://localhost:3000` |
| Redirect URL許可リスト | 0件 |
| Custom SMTP | OFF、標準メール |
| メール送信上限 | プロジェクト全体2通/時（標準SMTPでは変更不可） |
| メールOTP | 有効期限3600秒、8桁 |
| JWT | 有効期限3600秒 |
| Refresh token再利用検出 | ON、再利用猶予10秒 |
| Single session / time-box / inactivity timeout | OFF / 0（無期限）/ 0（無期限）。変更UIはPro限定 |
| 最低パスワード長 | 6文字、追加文字種要件未設定 |
| Secure email change | ON |
| Secure password change / current password必須 | OFF / OFF |
| Leaked password protection | OFF、Pro限定 |
| Auth CAPTCHA | OFF（今回変更していない） |
| Auth Hooks | 登録なし |
| Signup確認テンプレート | 既定の `ConfirmationURL`。標準SMTPでは編集不可の表示 |
| Signup/signin / token verify制限 | 各30回/5分/IP |
| Token refresh制限 | 150回/5分/IP |
| IP forwarding | OFF |
| Authユーザー / セッション | 0 / 0 |

標準メールは組織のチームメンバーの宛先に限定され、配送保証はない。管理するメールというだけでは送信できない。2宛先がこの条件を満たすかは**未確認**。メール受信だけの目的で組織権限を付与しない。該当しない場合は専用SMTPと費用・送信者ドメインの承認を先に得る。[標準SMTPの制約](https://supabase.com/docs/guides/auth/auth-smtp)

## 2. 承認後に必要な設定

第一候補はMacの**専用ローカル作業コピー、127.0.0.1だけで待ち受けるサーバー**。既存`.env.local`を持ち込まず、専用環境変数をプロセスにだけ渡す。提案URLは `http://localhost:5198`（実行前にポート空きを確認）。ブラウザーのホスト名をlocalhostで統一する。スマートフォンからの実接続試験はこの構成の対象外。

新DBだけのSite URLを上記へ変更し、許可リストへ `http://localhost:5198/auth/callback` を追加する。初回はsignupと必要時のresendのみ。recoveryは追加メールと別承認が必要なため、`?next=recovery` は初回に追加しない。ワイルドカードや既存Preview URLを許可しない。[Redirect URL仕様](https://supabase.com/docs/guides/auth/redirect-urls)

新Authのパスワード最小長を12、大小英字・数字・記号をアプリと整合させる変更を提案する（未実施）。アプリ側は既に12〜128文字と文字種を検証するが、Auth直呼びは現在6文字の設定に従う。メール確認ONは維持する。JWT・refresh設定は変更しない。Proアップグレードは不要。

Auth CAPTCHAを有効化する場合、現在のsignup/login/resendは `captchaToken` をSupabaseへ渡していないため先に別途実装・試験が必要。匿名相談用Turnstileとは別の経路。今回は既定OFFを保持しただけであり、保護を無効化して成功扱いしていない。

## 3. アカウントとメール計画

送信直前にユーザーが管理する2つの異なる実宛先A/B、送信総数、送信時間帯、後片付けを承認する。メール本文・パスワード・確認URL・JWT・Cookieはチャット、CI、Gitに残さない。パスワードの入力・保存はユーザーが行う。ログはA/Bラベル、HTTP状態、件数、時刻、匿名化したrun IDのみ。

| 順番 | 宛先・操作 | 最早時刻の例 | 目的 |
|---|---|---|---|
| 1 | A signup | T0 | 未認証→メール確認→ログイン |
| 2 | B signup | T0+1分 | 未認証拒否、別ユーザー |
| 3 | AまたはB resend（必要時のみ） | 最後の2通から61分以上後 | 未着/期限切れの再確認 |
| 4 | AまたはB resend（必要時のみ） | 同一宛先はさらに60秒以上 | 予備、上限4通 |

通常2通で終える。予備2通は自動送信しない。Bの確認リンクを1時間以上開かず期限切れを試す場合は、その後のB resendを予備枠へ割り当てる。最後に発行された有効リンクのみ使用する。

実行時は単一担当・単一プロセス、プロジェクト全体の送信台帳で予約してから送る。タイムアウトや失敗も送信試行として枠を消費し、結果不明を再送しない。実行再開時も台帳を保持し、他の実行がないことを確認する。2通/時を429になるまで連打して検証しない。今回追加した `checkAuthMailPlan` は**オフライン予定表の検査であり、送信器・永続台帳・並列制御ではない**。実行担当が台帳と実際の送信状態を照合する。[Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)

## 4. 実認証の検証手順（全件未実施）

| ID | 手順 | 成功基準・証拠 |
|---|---|---|
| A01 | 新DB/ref・APIキー所属・ローカルoriginを照合、Auth0件から開始 | 旧DB/旧envなら停止。`/api/auth` GETで未認証 |
| A02 | UIからA signup、未認証のままログイン/会員APIへアクセス | 実メール1通、未認証拒否。admin.generateLink/email_confirm:trueを使わない |
| A03 | 登録した同じブラウザーで受信リンク→callback | PKCE code交換、getUserでemail_confirmed_at。相談の自動引き継ぎなし |
| A04 | パスワードlogin/logout、再login | httpOnly/SameSite=Lax、Cookie保持/削除と匿名Cookie更新。HTTPS PreviewではSecureも確認 |
| A05 | 別ブラウザーでAをpassword login | 独立セッション。新規登録メールのPKCEリンクを別ブラウザーで交換する試験と混同しない |
| A06 | B signup→未認証拒否→メール確認 | 2通目、異なるAuth UUID。未認証状態はadmin変更で作らない |
| A07 | 無効/使用済み確認コード・改変JWT・Cookieなし・異なるOrigin | 非成功、会員履歴未作成。秘密値は記録しない |
| A08 | JWTの実期限を待って更新、同時更新・古いrefreshの再使用 | 実Authの更新を確認。10秒の猶予/親token例外を失敗と誤判定しない |
| A09 | local logout後のrefresh、別ブラウザーのセッション | ログアウトしたrefreshは拒否、別ブラウザーはlocal scopeで残る |
| A10 | logout前access JWTの期限内/期限後のAPI結果を比較 | 期限内JWTが残り得ることを記録。即時完全失効を成功基準にしない |
| A11 | BでA所有の診断/相談URL・APIへアクセス | アプリ所有権チェックとData API/RLSを別々に検証。service_roleでRLS成功を代用しない |
| A12 | Cookie消去/更新/戻る進む・再loginで履歴 | 所有者だけに表示、ブラウザーキャッシュから漏れない |

既存Authは `@supabase/ssr` と匿名キーでsignUp/signIn/verifyOtp/code交換し、サーバーの `getUser` で確認済みユーザーだけを認証扱いする。service_roleはrate-limit・所有権を確認したDB処理専用で、ブラウザーへ渡さない。登録callback/loginには旧診断の `claimDiagnoses` があるが、匿名AI相談は明示同意の別API。標準テンプレートのConfirmationURL→PKCE callback方式はコード上整合、**実配送・実ブラウザーでの互換性は未検証**。

Supabaseのlogoutはrefreshを失効させるが、発行済みaccess JWTは期限まで有効になり得る。アプリのgetUserと直接Data APIの挙動を実測して区別する。無期限session設定でもrefresh取り消しは可能。[セッション](https://supabase.com/docs/guides/auth/sessions)、[signout](https://supabase.com/docs/guides/auth/signout)

## 5. 匿名相談引き継ぎ：OFFを維持した段階的検証

現在はアプリのTRIAL_ENABLEDとDBのenabledがともにOFF。新規セッション・回答APIを成功させるには有効化が必要なので、**登録なし開始→回答取得までを今回の設定で実Auth E2E合格とはできない**。OpenAIを合成回答に変えるだけでもDBの停止条件は解除されない。未実装の本番用モック切替を導入しない。

次段階の推奨は、承認した少数の**暗号化された合成匿名相談fixture**を新DBだけに投入し、実認証＋実 `/api/trial/claim` 以降を検証する方法。claimは新規生成のON/OFFから分離されているため、AI OFFのまま既存相談を引き継げる。投入SQL/専用ハーネスはまだ作成・実行していない。run ID、件数、暗号鍵、セッションhash、24時間期限、cleanup対象を明示してDockerで検証後、DB書き込みの別承認を得る。Authは実signupで作成したA/Bを使用し、偽JWTやAuth確認フラグの直接更新を使わない。

合成回答の出所を画面・記録に明示し、(1)A同意＋expectedEmail一致＋元ブラウザーcookieでclaim、(2)再login後の会員履歴、(3)B/偽造cookie/期待email不一致の拒否、(4)同時A/B、(5)削除済み/24時間超過の拒否、(6)途中エラー時の所有者・履歴不変を確認。同じAの再送は既存実装の冪等結果（同じID、履歴増加なし）を期待し、「必ずエラー」と誤記しない。異なるユーザーへの二重所有移転は拒否する。

時間経過は専用の期限切れfixtureと24時間の実待機を区別して記録。SQLで時刻を変えた試験を実時間経過の成功扱いにしない。新規相談開始・予約・回答保存は既存Docker HTTP16件で回帰するが、クラウドAuthとの一連の実試験は未実施。

全フローが必要になった場合のみ、専用実行環境の合成provider、実Turnstile、実Auth、新DBの一時的有効化・掃除処理・予算/停止条件を含む別設計と承認が必要。今回そのフラグやDB設定は一切変更しない。実OpenAI料金は0、アプリの合成usage推計は請求ではない。将来の1日3ドル制御も外部請求の絶対保証にはしない。

## 6. Turnstile

Authだけの初回は現在の設定どおり不要。匿名相談開始の外部試験では専用widgetを用意し、承認済みホストだけを登録、action=`trial_session`、公開site keyとサーバーsecretを分離する。既存widgetを流用しない。サーバーはSiteverifyのsuccess、hostname一致、action一致、challenge時刻5分以内を既に確認する。

公式dummyキーはローカルの成功/失敗試験専用。任意hostname/actionを受け入れる変更はしない。実widgetの検証は別承認後に行う。tokenは5分・1回限りで、再利用/期限切れ/不一致を拒否する。[Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)、[テスト用キー](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)

## 7. 実行環境・キーと分離

| 設定 | Authだけのローカル初回 |
|---|---|
| Supabase URL | `https://ukdzggjfkcwjssjmnqim.supabase.co` |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 新DBのanonキー、Authクライアント用途。既存コードの変数名を維持 |
| SUPABASE_SERVICE_ROLE_KEY | 新DB専用、サーバーだけ、既存RLS/ACLを拡大しない |
| SESSION_SECRET（recovery Cookie署名にも使用） | 新しいローカル専用乱数、旧環境からコピーしない |
| NEXT_PUBLIC_APP_URL | 承認したlocalhost:5198 |
| TRIAL_ENABLED / RETENTION_VERIFIED / BUDGET_VERIFIED | すべてfalse（正式名はTRIAL_RETENTION_VERIFIED、TRIAL_BUDGET_VERIFIED） |
| PUBLIC_INDEXING_ENABLED / PREVIEW_DEMO_ENABLED | false / false |
| STRIPE_MODE / STRIPE_ACCOUNT_ID | sandbox / acct_1UQlQdI73kTcvXz8 |
| STRIPE_LIVE_CHECKOUT_ENABLED | false |
| Stripe秘密鍵・Webhook secret・OpenAIキー・Cron secret | 設定しない |

Auth登録とログインでも `rate_limits`、Authセッション、profileトリガー等の書き込みが生じる。匿名相談fixtureではTRIAL_SESSION_SECRET、TRIAL_ENCRYPTION_KEYも新規に必要。これらのキーは今は取得・配布しない。標準SMTPを使える場合SMTPキー不要。独自SMTPが必要なら送信専用資格情報だけを新DBのSMTP設定へ登録する承認が必要。

ローカルの外向き通信は新Supabaseのみに限定し、Stripe/OpenAI/既存Supabaseを許可しない。これは将来構築時に通信遮断の実効性を試す条件で、URL変数だけで通信隔離を保証するという意味ではない。アプリを外部へ公開するトンネルは使わない。

代替Vercel案：新プロジェクト `yorisoi-auth-integration-test`（未作成）、Preview専用キー、All Deployments保護、noindex、Cronなし、git自動デプロイなし。既存demo/fixed Previewは維持。新URLだけをAuth callbackに許可し、実targetをAPIで確認する。**Production分類なら停止し、本体を配置しない**。初回Production問題を回避する仕組みが確定しない限りローカルを使う。ダミーProductionの例外承認を今回流用しない。保護のSSO認証とアプリのAuthを区別し、callback前のSSOでPKCEを失わないことも検証する。作成・秘密鍵登録・デプロイはすべて別承認。

## 8. Stripe整合性（新DB読み取り、Stripe API未呼出し）

- payment_environment：sandbox / `acct_1UQlQdI73kTcvXz8`。
- price_versions：6件すべてactive=false。旧4件には不活性のLive識別子も残るが、削除/書換えしない。
- 単発：`report-integration-202610-980-v1`、980 JPY、`price_1UQlnvI73kTcvXz8twnU8NIR` / `prod_VRf89e8A94b0mb`。
- 月額：`plus-integration-202610-980-v1`、980 JPY、`price_1UQlpjI73kTcvXz814TUAfOd` / `prod_VRfAjqXSjem3nl`。
- Portal：`bpc_1UQlv6I73kTcvXz8G4TVvwUm`。無料3回・Plus30回。
- migration17、RLS42/42、service_roleのauth.users直接SELECT不可、Auth/セッション/顧客/購入/契約/相談thread0、trial enabled=false、Cronなし。
- コードは環境変数とDB account/modeを比較し、Stripe接続時はAPIのaccount IDも確認。今回はキーなし・接続なし。Webhook送信先を作らず、旧Sandboxのsecret/送信先を登録しない。
- 今回確認できたのはDB設定とコードの整合性。Stripe上の最新オブジェクト・charges_enabledは再照会しておらず、過去の商品設定報告を参照。実Checkout/Portal/請求は未検証。

## 9. 変更と検証

- `scripts/auth-live.mjs`：`.env.local`自動読取を廃止。admin.generateLinkによる旧fixture試験を、明示的なローカルopt-in＋両接続先loopbackへ限定。新旧hosted DB・Vercel・productionでは開始前に拒否。これは実メール試験として使わない。
- `scripts/phase6/auth-preparation.mjs`：上記guardとオフライン送信予定検査。失敗/結果不明の試行も予約として数える設計。
- `tests/auth-preparation.test.ts`：20件追加。旧DB/新DB/既存Preview/ホスト偽装/URL資格情報/未指定/production、メール上限・宛先・時刻など。
- アプリ本体、Auth API、17migration、RLS、既存テスト、CI workflowは変更なし。
- 外部接続33件は**全件未実施・未検証**。Authの読み取り調査やローカルモック成功を33件の成功に含めない。[既存対応表](phase6-external-test-matrix.md)の28件条件付可・5件要改修を維持。

ローカル検証：既存501件＋追加20件＝521件成功。外部33件は既存の明示的な非実行状態を維持。lint・型チェック成功。DockerのStripe初期化29項目、隔離DB migration/権限/競合/復元、実HTTP16シナリオ成功（Auth・Turnstile・OpenAIはモック）。Next.jsビルド成功。GitHub CIはこの変更コミットに対するActions runを確認し、完了報告に結果とURLを記録する。

## 10. 費用・停止・復旧・次の承認

今回追加費用0、新規クラウド資源0。ローカル＋既存Free枠内＋標準メールを利用できれば初回Auth試験の追加サービス費用0を想定し、実行直前にFree枠を再確認する。独自SMTPの費用はサービス・宛先・ドメイン未選定のため未確定。TurnstileにはFreeプランがあるが新widgetの作成は未承認。[Turnstileプラン](https://developers.cloudflare.com/turnstile/plans/)

不明な送信、429、違うref/host/account、想定外の利用者/データ、無効な保護、外部AI/Stripe通信を検知したら即停止。サーバー終了、ログを機密値なしで保全し、読み取りで状況確認する。自動再送・自動削除・全体DB resetはしない。承認したrunの2ユーザー/fixtureだけを、依存関係を確認して後片付けする別承認を得る。Authシステムスキーマをdumpで上書きしない。Site/redirect/password設定は変更前を記録し、新DBだけを元に戻す。過去の暗号化バックアップを上書きしない。

次に必要な承認は：

1. 新DBのSite/redirect URLとパスワード要件の変更、および専用ローカル環境への新DBキー設定。
2. 宛先A/Bの確定、標準SMTPの宛先資格確認（満たさなければ専用SMTPの設定・費用）。
3. 実signup2名、最大4メール、Auth/アプリ付随書き込み、実セッション試験、run限定後片付け。
4. 匿名AI OFFのまま引き継ぐ少量の合成相談fixtureの具体的内容・投入/削除手順。
5. 追加で必要な場合のみ、専用Turnstile widget、独立Vercel環境、全匿名開始フローの合成provider構成と一時的有効化条件。今回は実施しない。

既存partner-mind DB・Stripe・2つのPreviewにアクセス変更はない。main変更・デプロイなし。第2開発単位へ進まず、承認を待つ。
