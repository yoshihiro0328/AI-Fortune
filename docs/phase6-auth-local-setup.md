# Phase 6 STEP 6：新Auth設定・読み取り専用ローカル環境

2026-10-16。対象 `ukdzggjfkcwjssjmnqim` のみ。**実ユーザー作成・メール送信は未実施、次の承認待ち。**

## Auth設定変更前後

| 設定 | 変更前 | 保存・再表示で確認した変更後 |
|---|---|---|
| Site URL | http://localhost:3000 | http://localhost:5198 |
| Redirect URL | 0件 | http://localhost:5198/auth/callback の1件のみ |
| 最低パスワード長 | 6 | 12 |
| 必須文字種 | なし | 小文字・大文字・数字・記号 |
| Confirm email | ON | ON維持 |
| OTP期限/桁数 | 3600秒/8桁 | 不変 |
| JWT期限/Refresh再利用猶予・検出 | 3600秒/10秒・ON | 変更なし |
| プラン | Free | Free維持、追加費用0 |

ワイルドカード・他サービスURLは追加していない。文字種の最強設定はFreeで保存できた。アプリ側の12〜128文字・大小英字・数字・記号の検証も維持。Supabase側にアプリの128文字上限まで同一設定を加えたわけではない。漏洩パスワード検知はPro限定のためOFFを維持し、有料化していない。

変更はDashboardの新DBのURL設定とEmail providerだけ。DB migration・Auth ACL/RLS・JWT/Refresh設定は変更していない。UI上の「main PRODUCTION」はSupabaseのbranch表示であり、本体アプリのProduction公開ではない。

### 戻す場合（未実行）

別途承認後、新DBのSite URLを`http://localhost:3000`に戻し、追加したcallback URLだけを削除する。Email providerで最低長6・必須文字種なしへ戻す。メール確認ONその他は保持する。パスワード要件を弱めるため通常は戻さず、新しいローカル検証を止めるだけでよい。Authユーザーやシステムスキーマのリセット・復元は不要。

## 専用ローカル構成

- リポジトリ外の`../private-auth-step6/app`へ追跡対象だけを展開し、新たにNext.js build。旧`.env.local`、旧`.next`、`.vercel`、秘密鍵をコピーしていない。既存node_modulesだけを共有。
- アプリは`127.0.0.1:5198`のみで待受け。URLは **http://localhost:5198**。外部公開トンネルなし。
- 中継も`127.0.0.1:5199`のみ。アプリをmacOSの`sandbox-exec`内で実行し、中継ポート以外への外向き通信をOSで禁止。直接TCPはEPERM、直接DNS/外部fetchも失敗することを確認。
- fetchラッパーと中継の両方で、新Supabaseの固定HTTPS origin＋限定GET/HEADパスだけを許可。TLS証明書検証ON、redirect追跡禁止。中継は専用ローカルトークンを要求し、APIキーも新DBの2キーだけに限定。
- 読取許可はAuth settings/userと診断種別・質問・料金・設定・診断テーブル。RPC、signup、verify、token、メール、POST/更新/削除は許可しない。
- アプリ入口でもGET/HEAD以外、Auth callback、Cron、外部画像取得を拒否。ブラウザー側もCSPで外部接続を禁止し、noindex/no-storeを付与。
- これは承認前の**表示確認専用ハーネス**。本体APIの挙動を変更したり、認証を成功に見せるモックではない。実メール試験へは送信経路を承認範囲に絞って別途準備・検証する必要がある。単純に全遮断を解除しない。

### 保管と起動

専用キーをSupabase CLIの新Project Ref限定読み取りで取得し、JWTのref/roleをローカルで照合。anonとservice_roleだけを保持し、不要な取得結果ファイルを削除した。SESSION_SECRETは新規乱数。キーは発行/ローテーションしていない。

秘密情報はGitリポジトリ外の`../private-auth-step6/runtime.json`（0600）、専用ディレクトリは0700。Macユーザーのみがアクセスできるファイル権限で保護。**アプリ独自の暗号化やKeychain保存を実施したという意味ではない**。キー値はログ・引数・チャット・Gitへ出していない。ブラウザー配信ファイルとログにservice_role/SESSION_SECRETが含まれないことを検査済み。

起動はmacOS専用の`python3 scripts/phase6/local-auth-launch.py ../private-auth-step6`。元の`.env.local`を自動読込する旧auth-liveをHosted DBへ向けて実行しない。プロセスIDは専用ディレクトリの`pids.json`。停止時は記録したserver/proxyプロセスだけを停止し、他環境のプロセスを巻き込まない。今回は確認用画面として起動を維持するが、登録・送信は常に拒否される。

TRIAL_ENABLED、TRIAL_RETENTION_VERIFIED、TRIAL_BUDGET_VERIFIED、STRIPE_LIVE_CHECKOUT_ENABLED、PREVIEW_DEMO_ENABLED、PUBLIC_INDEXING_ENABLEDはすべてfalse。STRIPE_MODE=sandbox。Stripe秘密鍵・OpenAIキー・Webhook secret・Cron secretなし。

## 実接続での確認結果

| 確認 | 結果 |
|---|---|
| TOP | 200、ブラウザー表示、匿名相談準備中 |
| 無料診断 | 200、説明・同意前画面を表示。新DBの質問9件を読取。診断開始/保存は未実施 |
| アカウント | 200、未ログイン表示・履歴なし |
| GET /api/auth | 200、user=null / recovery=false |
| GET /api/consultations・/api/billing | 実アプリの認証チェックで401 |
| POST /api/auth・/api/diagnoses・/api/events | ローカル入口で403、DB/メール処理へ到達しない |
| Auth callback・Cron | ローカル入口で403 |
| 新Auth settings | 新DBの公開設定を読取、mailer_autoconfirm=false |
| 中継経由signup/verify/RPC/書込 | 403、外部へ転送しない |
| 通信先 | 中継ログはukdzggjfkcwjssjmnqim.supabase.coのみ。旧DB・Stripe・OpenAIへの転送0 |
| 秘密鍵漏れ | クライアントbundle/ログ内のservice_role・SESSION_SECRET検出0 |

上記ハーネスの検証は19項目成功。APIの401と、承認待ちハーネスの403は別々に記録する。解析イベント等のPOSTも意図的に403となるため、ブラウザーでブロック応答が出ても本番機能の失敗とは混同しない。登録・ログインの実成功、メール配送、診断生成は検証していない。

新DB事後SQL（読み取りのみ）：Authユーザー/セッション、profile、診断、rate_limits、analytics、顧客、購入、契約、相談thread、匿名sessionはいずれも0。migration17、RLS42、service_roleのauth.users直接SELECT不可。trial enabled=false。価格6件/active0、新Stripe accountは不変。両Stripe Sandboxの設定は操作していない。

## メールA/Bと標準SMTPの制約

STEP 7追記: 宛先A/Bは現在保存済み。独自ドメイン不要のMailerSend Sandboxを比較検討し、最新の推奨・承認手順を[SMTP選定資料](phase6-smtp-selection.md)へまとめた。以下のSMTP推奨はSTEP 6時点の記録。

**AI FortuneのTeam画面でメンバーは1名。異なる2宛先を標準SMTPの許可対象にする条件を満たせない。** メンバーのメール値はチャット・Git・報告書に記載せず、照合用に専用ローカル領域へ保管。メンバー招待はしていない。

A/B入力用に、127.0.0.1限定・ランダムパス・同一Origin/Host検証・no-store・CSPの専用画面を用意。外部通信を一切持たず、異なる2つの宛先だけを0600で保存する。パスワード・認証リンクは収集しない。入力結果はその時点の完了報告で区別する。未入力を承認済みと扱わない。

標準SMTPはプロジェクト全体2通/時・チームメンバー宛先のみ。初回予定はA/B各1通、計2通、Authユーザー2名。予備2通は自動送信しない。[Supabase SMTP仕様](https://supabase.com/docs/guides/auth/auth-smtp)

2名で実施するには、独立した送信専用SMTP資格情報と、ユーザーが管理する送信ドメインを新DBへ設定する案を推奨する。現時点では提供元/ドメイン未確定で費用は未確定。今回費用は0だが、新SMTPを無料と仮定して契約しない。

具体的な設定案：管理ドメインの認証用サブドメインを選び、送信元例`no-reply@auth.<管理ドメイン>`、SMTP host/port（提供元指定のTLS/STARTTLS）、送信専用user/password、sender name「よりそい検証」を新DBだけへ設定。SPF/DKIMとDMARC、送信者認証を確認し、メールリンクのクリック追跡をOFFにする。既存のマーケティング/本番SMTPキーをコピーしない。提供元の無料送信上限、独自ドメイン要件、超過課金・自動アップグレードの有無を確認してから費用付きで承認を求める。Custom SMTPでも初回2通・再送別確認の自主制限を維持する。DNS・SMTP設定・契約は今回は行わない。

## 品質・既存環境

- 既存521＋追加23＝**544件成功**。外部33件は既存の未実行状態を維持し、成功扱いしない。
- lint・型チェック成功。旧envなしの専用コピーでNext.js build成功。
- Docker初期化29項目、隔離DB migration/権限/競合/復元、HTTP16シナリオ成功。Docker内Auth/Turnstile/OpenAIはモックであり実サービス試験ではない。
- GitHub CIは本コミットのActions結果を最終報告へ記録する。
- 本体アプリ・17 migration・既存テストに変更なし。変更はローカルハーネス、入力画面、検証コード、資料のみ。
- 既存DBには接続していない。既存/新Stripe設定、既存Preview、デモPreview、main、Productionは変更なし。開発ブランチは既存vercel.jsonでgit自動デプロイ無効。

## 実行直前に必要な確認・承認

1. A/Bの管理権限と実宛先をローカル入力で確認し、専用SMTPの提供元・ドメイン・料金・設定変更を承認する。
2. 対象は`ukdzggjfkcwjssjmnqim`、初回メール2通、作成予定Authユーザー2名。署名付きAPIキーのref、戻り先、実Auth設定を再確認。
3. 予定DB書き込み：Auth users/identities/sessions/refresh tokensとAuthログ、アプリのrate_limits、Authトリガーが作成するprofile等。診断・相談・購入・契約データは初回には作成しない。
4. 終了後は今回作成したA/B UUID・run IDに限定して、セッション失効→関連データの確認→テストユーザーと付随データの削除。発行済みaccess JWTは期限まで残り得るため、localhostサーバーも停止する。削除の具体的対象と実行を別途承認し、全体resetやAuthスキーマ復元は行わない。
5. 受信不能・結果不明・429・宛先不一致なら即停止。再送しない。合成相談fixture、匿名AI有効化、Stripe/Webhook/OpenAI/Vercelは今回の承認に含めない。

実ユーザー作成・実メール送信の直前で停止し、ユーザーの最終確認を待つ。

## 宛先入力画面の修正（2026-10-16）

ユーザーから「拒否しました」の報告を受け、合成宛先を用いたブラウザー操作で再現。`Referrer-Policy: no-referrer`により同一画面のPOSTでも`Origin: null`となり、厳密なOrigin検証が拒否していた。`same-origin`へ修正し、他originへのreferrer送信は禁止したまま、正規POSTのOriginを維持する。null/欠落/異なるOriginを許可する例外は加えていない。ブラウザーの先読み接続で単一スレッドサーバーが停止する問題も、ThreadingHTTPServerで解消した。

保存前の拒否であり、報告時点の実宛先は未保存。パスワードや認証リンクは収集せず、メール送信・ユーザー作成は行わない。SMTP提供元・管理ドメインについてユーザー回答は「未定」。選定・費用確認・設定承認が整うまで実送信へ進まない。

回帰検証はローカルHTTPで8件（正常保存/0600/上書き拒否、Origin/null/Host/path拒否、入力検証、先読み同時接続、レスポンスの保護設定）。CIにも追加。ブラウザーで合成宛先の保存成功を別の一時ディレクトリで確認し、実宛先保存先へ混入させない。
