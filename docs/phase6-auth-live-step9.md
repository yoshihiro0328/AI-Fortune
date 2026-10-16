# STEP 9 実メール認証検証（B認証エラーで停止）

対象: `ukdzggjfkcwjssjmnqim` のみ。基準 `f70ba57ea3a758ad34e8ab4a4370f91556507897`。

承認範囲は保存済みA/B各1ユーザー・登録確認メール各1通。再送・回復メール・相談fixture・Stripe/OpenAI・Vercelは禁止。Aの受信・認証・ログインが確認できるまでBは遮断する。

## 実行前

新DB ACTIVE_HEALTHY、Auth users/sessions/profiles/rate_limits 0、migration17、価格6/active0、trial OFF、service_role Auth直接SELECT不可。MailerSend Sandboxで送信0、SMTPユーザー1、追跡OFF。Custom SMTP ON、メール確認ON、localhost:5198と専用callbackを再確認。宛先値は記録せず、私有ファイル内の異なる2宛先を照合。

## ローカル限定の追加制御

本体の認証コード・CSRF・PKCE・Cookie・RLSは変更しない。STEP6表示専用ハーネスは残し、STEP9専用ランチャーで既存の専用アプリコピーを起動する。既存.env.localは読み込まない。

- 127.0.0.1:5198、通信中継5199のみ。アプリプロセスはOSのsandboxで中継以外の外向き通信禁止。
- 外部originは新DBのHTTPSに固定。登録、PKCE交換、password login、refresh、local logout、getUserと認証の既存RPC2件のみを書込許可。read-only画面用GETは既存範囲を維持。
- 入口でもauth POSTは保存済みA/Bのsignup/loginとlogoutのみ。現在stageはA。異なるOrigin、再送、reset、他の書込は拒否。
- signupを外部へ転送する前にラベル別予約ファイルをO_EXCLで作成し、fsyncする。重複・並列・再起動・失敗・結果不明でも枠は戻さない。2ラベル以外の予約不可。予約ファイルは自動削除しない。
- Authレスポンスから取得した許可宛先のUUIDだけを記憶し、確認済みUUIDのみ既存claim RPCへ渡す。JWTの実署名/認証判定はSupabaseのgetUserに任せ、ローカルのJWT内容検査だけで認証成功扱いしない。
- 上流がエラーや通信不明ならSTOPファイルを作成し、それ以降の外部通信を拒否。想定した否定テストは別途実行前に制御を準備する。
- アカウント画面から自動起動する決済・相談利用枠APIは今回遮断。これらの表示不成立を認証成功と混同しない。
- 記録はラベル、UUID、確認状態、パス、HTTP statusのみ。宛先、password、JWT、確認URL/コードをログへ書かない。

資格情報はリポジトリ外の既存私有領域（0700/0600）。SMTPキーは取得せずMacパスワードに保持。Authパスワードは本人がブラウザーで入力・保存する。

## 品質結果

553件維持 + 追加28件 = 581件成功。外部33件は未検証。lint/型チェック成功、旧envなしの専用コピーでNext.js build成功。Docker隔離DB/HTTP16シナリオ成功。ローカルHTTPでは未ログイン取得、再送/reset/B拒否、実APIの不正password schema拒否、CSRF/無関係書込/中継制限を確認。これらの事後もAuth users/sessions/profiles/rate_limitsは0。

実送信・受信・確認リンク・ログインの結果は、本人操作後の証拠に基づき追記する。現時点で成功とは扱わない。

## 停止・削除

送信不明、SMTPエラー、未着、想定外書込なら停止し再試行しない。Authユーザーを作成した場合はローカルのラベル別UUID記録とDB参照で関連範囲を特定する。別途承認後、該当UUIDのセッション失効、関連profile等の参照確認、限定削除を行う。DB resetや全ユーザー削除は禁止。認証監査/メール配送ログの保持は各サービス仕様に従う。現在は削除を行わない。

ログアウトはrefresh sessionを失効させるが、発行済みaccess JWTの署名とexpが有効な間は必ずしも全サービスで即時無効にならない。実際のセッション確認APIの結果と、期限によるJWT失効を分けて報告する。

## 実サービス結果・停止（2026-10-16 JST）

**Bの確認リンクエラーにより、STEP9は途中停止。成功扱いしない。** ローカル中継はBのpassword grant 400で自動STOP、その後サーバー/中継のプロセスを停止した。再送、再登録、トークン再発行、ユーザー削除は実施していない。

| 項目 | 実測 |
|---|---|
| A | signup200、本人受信確認、メール認証済み、PKCE交換200、getUser200、プロフィール作成、画面更新後もログイン維持 |
| A未認証状態 | 本人が直ちにリンクを開いたためDBの未認証状態を単独観測していない |
| B | signup200、本人受信確認、DB未認証状態を観測。確認リンク操作後にエラー。password loginはemail_not_confirmed/400で拒否 |
| 配送 | MailerSend履歴2行ともDelivered。宛先A/Bが含まれることを値を出さず確認。Supabase user_confirmation_requested 2件、signup200 2件 |
| リンクエラー | 実行時間帯のSupabase /verifyにOne-time token not foundが2件。PKCE成功はAの1件のみ |
| DB | Authユーザー2（確認済み1/未確認1）、セッション1、profile1、rate_limits8 |
| 未投入 | 診断・支払・契約・相談thread/turn各0 |
| 維持 | 17migration、42RLS、価格6件active0、trial OFF。旧DB/Stripe/OpenAI/Preview変更なし |

確認リンクの出所・コピー欠落・既使用リンク・メール側の自動アクセス等のどれが原因かは未確定。秘密URLやトークンは採取/記録せず、上記エラーだけを機密値マスク付きのログSELECTで取得した。SMTP認証失敗ではない。DBのAuth audit_log_entriesは0件で、今回のAuth監査イベントはSupabaseのauth_audit_logsに存在した。

Bの認証とログイン、パスワードログイン成功、ログアウト/再ログイン、別ブラウザーログイン、refresh/失効、無効token、Cookie削除、実A/BプロフィールRLSは停止に伴い未検証。相談所有権はfixture未投入のため別工程。外部33件の既存一括テストは未実行のまま。今回の実Auth観測を33件成功へ読み替えない。

### セッション検証用の追加準備（実サービス未実行）

ローカルだけの`/__step9`検証パネルを準備し、SDKによるrefresh、anonキー+本人JWTによるprofile RLS、無効署名の拒否、ログアウト前後のrefresh失効、認証Cookie除去を検証できるようにした。本体ルートには追加していない。トークンは一時メモリだけで扱い、応答/ファイルにはboolean・status・ラベルのみを出す。プロフィール読取にservice_roleは使わせない。正常ログアウト後にもAccess JWTのexpが残り得る事実を別項目として返す。

この検証パネルと最新の補強版ハーネスは、Bエラー時の稼働プロセスには未読込・未使用。停止後に再起動しておらず、実refreshやRLSを成功扱いしない。追加13件のオフライン検証を含め **553既存+41追加=594成功**、外部33未実施。lint/型チェック成功。Next.js専用コピーbuildとDocker HTTP16成功。本体source/既存migration本文の変更なし。

### 復旧案（別途承認後）

1. Bとして保存した宛先宛て・送信時刻16:00:58 JSTのメールを本人が確認し、認証リンク自体をチャットへ送らず、正しいメールと保存済みブラウザー状態が揃うか確認する。
2. 調査用に停止中のlocalhost環境だけを再開する場合も、送信予約2件を保持し、stageを登録不可にする。既存Bリンクの利用可否を確認する操作を別途承認する。期限/消費状況により利用できない場合も自動再送しない。
3. 新しいメールが必要ならB宛て1通について別途承認を取得し、専用の新しい送信枠・同じブラウザーのPKCE状態・期限を管理する。既存予約を削除してsignupを再実行しない。管理者による確認済み化は禁止。
4. Aの既存セッションは残存。サーバー停止はセッション失効ではない。セッション失効テストやユーザー削除は未実行のまま、再開/限定削除を別途承認する。

削除対象UUIDはGit管理外の`private-auth-step9/cleanup-targets.json`にA/Bラベルで保管。削除前に各UUIDのAuth identities/sessions/refresh tokens、profileと関連FKを読み取り照合し、当該2名に限定する。rate_limits8件はハッシュ化IP/匿名セッションの共有枠を含むため、ユーザーUUIDだけで一括削除しない。監査/配送ログの保持制限も区別する。全DB reset・全Auth削除・既存環境への操作は不要。

## B限定再送の承認後準備（2026-10-16）

新DBの既存B UUIDと保存済み宛先の一致を値非公開で照合し、B未認証・A確認済み/セッション1・全価格無効を確認。MailerSend配送2通、日次残枠98を送信前に確認した。

`resend-b`段階はBへの正規resend、PKCE交換、認証に必要なRPCと限定読取のみ許可する。新規登録・A再送・password/refresh/logoutはB認証完了まで拒否。再送直前に`resend-b-1.reserved`をO_EXCL/fsyncで作成し、失敗・結果不明でも枠を戻さない。既存signup予約2件は保持。以前のSTOPは削除せず日時付きで保存した。

実ブラウザーのPKCE Cookie存在と未ログイン状態を確認。インストール済みSSR SDKのresendが、送信するS256 challengeと対応する新verifierをCookieへ保存することをモックで検証。新規17テスト追加、既存594と合計611成功。外部33件は未実施。lint/型チェック、専用コピーのNext.js build、Docker隔離DB/HTTP16成功。

17:08:23 JST、既存Bへresend POST200を1回観測。MailerSendの配送3行目がDelivered、全送信累計3通。DBのB UUID不変/未認証、Aセッション1、Authユーザー合計2。再送後のBブラウザーにもPKCE Cookieあり。本人には最新メールだけを同じブラウザーで1回開くよう案内した。確認リンク自体は取得・記録・先読みしていない。認証完了とセッション検証の結果は本人操作後に追記する。

### 再送後の結果：メール認証済み、ログイン未完了で再停止

- 本人が最新メールのリンクを操作してエラーを報告したため、STOPを作成しローカルアプリ/中継を停止。再送は1回、累計送信3通、MailerSendは3通ともDelivered。本人の受信・操作は確認済み。追加送信は行わない。
- 17:12:21 JSTにSupabase `user_signedup` と `/verify` 303。Bはメール認証済みとなり、再送分のPKCE flowで認証コード発行あり。
- 17:12:45 JSTに `/verify` が `One-time token not found`。本人から「先に別の画面・ブラウザーでも開いた」と回答あり。最初の操作でメール認証され、後続操作で消費済みリンクが拒否されたという解釈と整合する。最初のブラウザーのCookie欠落自体は直接観測していないため断定しない。
- 新しいPKCE `/token` 交換はローカル中継記録にも取得したSupabaseログにもない。Bセッション0、B profile未作成。メール認証の成功をログイン成功と扱わない。PKCE Cookieは再送前後にBの元ブラウザーで存在を確認していた。
- テンプレートは標準 `{{ .ConfirmationURL }}`。SMTP配送は成功。確認リンク自体を採取・HEAD/GET・プレビューしていない。メール自動スキャンによる消費の証拠はない。
- 最終新DB: Authユーザー2/認証済み2、identities2、セッション1（A）、profiles1（A）。診断/購入/契約/相談thread/turn0。migration17、trial OFF、価格active0、service_role Auth直接SELECT不可。
- Aのログアウト・refresh・セッション失効は行っていない。B成功後に予定したpassword login、logout/relogin、別ブラウザー、refresh、Cookie削除、本人JWTでのRLSは未実施。相談所有権/外部33件も未検証。
- 復旧案は追加メールではなく、認証済みの既存Bへ通常のpassword loginを行い、その成功後にセッション/RLS検証を再開する。今回はユーザーの「再度エラー時は停止」に従い実施しない。リンクの再利用、signup、管理者による確認済み化、ユーザー削除は不要。
- UI改善案（未実装）: 登録時ブラウザーで確認する案内、確認済みなら通常ログインへ誘導する説明、秘密値を記録しないcallback失敗段階の診断。自動先読み対策が必要と判明した場合のみ、公式仕様の中間確認画面/OTP方式を別設計し、CSRF・PKCE・所有権を維持してDockerで検証する。

GitHub CI（86400f6、run 38871950942）は**失敗**。Dockerイメージ配布元ECRが `toomanyrequests: Data limit exceeded` を返し、Stripe初期化の隔離DBチェックを開始できなかった。ローカル611テスト/HTTP16/ビルドの成功と区別し、CI成功とは報告しない。認証操作やメール送信はCIから実行していない。

事後の読取でSite URL `http://localhost:5198`、Redirect URL `http://localhost:5198/auth/callback` が不変であることを確認。CIで開始できなかったStripe初期化のDocker検証はローカルで29項目すべて成功（外部接続0、Stripe取引0）。

## Bのパスワード再設定準備（2026-10-17、メール送信未承認）

本人からMac/ChromeにBのパスワードが保存されていないとの回答。既存Bを維持し、既存アプリの `resetPasswordForEmail` → PKCE callback → `updateUser({password})` → 新パスワードでログインする。新規登録・確認メール再送・管理者による変更は行わない。回復メール1通の送信は**本人の最終確認待ち**。現時点で送信0、パスワード変更0。

### 読取結果

- 新DB `ukdzggjfkcwjssjmnqim` はACTIVE_HEALTHY。Authユーザー2/確認済み2、Aセッション1、Bセッション0、価格active0、trial OFF。保存済みB宛先と既存B UUIDの一致を、メール値を返さないハッシュ比較で確認。
- Site URLと専用callbackは不変。回復テンプレートは標準 `{{ .ConfirmationURL }}`。Password changed通知はOFF（追加通知の自動送信を避けるため確認しただけで設定変更なし）。
- MailerSend Sandboxのテストドメインは利用可能。過去の送信3/Delivered3/Rejected0、open/click/content/unsubscribe追跡OFF。新しい送信は行っていない。送信直前にも残枠と重複記録を確認する。

### ローカル限定の変更と検証

本体の認証コード/SQL17件/クラウド設定は変更していない。専用ハーネスに `auth-password-recovery.mjs` を追加し、次を制限する。

1. `reset-prepared` は全Auth書込を拒否。`reset-b` では保存済みBへの回復だけを入口で許可し、Bの既存UUID・確認済み状態・新DB専用anon keyを確認。Aへの送信、新規登録、signup再送は拒否。
2. 最終承認後にのみGit管理外へ作る `reset-b-1.approved`（対象Ref/UUID/宛先ハッシュ/1通/短い期限）を要求する。承認ファイルは今回作成していない。送信前に `reset-b-1.reserved` をO_EXCL + ファイル/親ディレクトリfsyncで確定。エラーや通信不明でも枠を戻さず再試行不可。既存signup2件/resend1件の記録は保持。
3. SDKが回復用の新verifierをCookieに保存すること、S256 challengeと一致することをモックで確認。今回予約したchallengeに合うverifierだけでコード交換できる。旧signupのverifierや別ブラウザーの値は拒否。callbackは `next=recovery` と単一codeだけを許可。メールURL/コード/verifierそのものは記録しない。
4. 回復ログインを確認してから手動で `password-b` 段階へ進める。本人入力の強いパスワードだけをPUTで許可し、email/phone/metadata変更を拒否。本人JWTをSupabaseが検証し、B以外の応答を受け付けない。既存アプリのglobal signOutはBのJWTに限るためAセッションへ適用できない。signOut成功はUI文言だけでなくプロキシ応答とDB状態で確認する。
5. 外向きorigin固定、OS通信制限、CSRF、署名付き回復Cookie、JWT/RLSは維持。回復段階のrefresh、データ引き継ぎRPC、Stripe/OpenAI/旧DB接続は拒否。準備用ローカルHTTPでreset/signup/resend/login/logout/updateの6操作が外部通信前に403となることを確認。

既存611 + 新規16 = **627テスト成功**。外部33件は未実施として分離。lint/型チェック、旧envなしの専用コピーでNext.js build、Docker HTTP16、Stripe初期化隔離DB29項目成功。実SDKのCookie永続化→回復コード交換→password update→B global signOutは合成応答で検証しており、実メール/実パスワード変更の成功を意味しない。

### 承認後の実行手順

- 実行直前にB未ログイン/認証済み、Aセッション1、対象Ref、SMTP/送信残枠、追加通知OFFを再確認。B宛て回復1通の明示承認を得てから承認記録を作り、段階を `reset-b` に切り替える。
- B登録に用いたアプリ内ブラウザー（localhost:5198）の既存再設定フォームで、保存済みBを使用して1回だけ送信。本人が最新メールのリンクを右クリックして「リンクのアドレスをコピー」し、**先に別ブラウザーで開かず**、同じアプリ内ブラウザーのアドレス欄へ貼り付けて1回だけ開く。調査用GET/HEAD/先読みは禁止。
- PKCE交換/B UUID/回復Cookieを確認後、新しいパスワードの入力・確認・送信は本人が行う（12〜128文字、大小英字/数字/記号）。Mac「パスワード」にB用として保存。メール未着・結果不明・リンクエラーは直ちにSTOPし、追加送信しない。
- 更新後、Bの回復セッション終了とAの元セッション不変を確認してから通常password loginへ進む。Bでログアウト/再ログイン/refresh/Cookie削除、A/B本人JWTのprofile RLSを検証する。Aの元セッションはログアウトやCookie削除の対象にしない。相談所有権はデータ未投入のため未検証のまま。

Supabase現行公式ソースのredirect判定ではSite URLと同一originへのパス/クエリ遷移を許可するため、既存 `?next=recovery` のためだけにクラウドallowlistを変更しない。ローカル側では厳密にこのURLだけを許可。Hosted実際のメール遷移は送信後に本人操作で確認する。

参考: [resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)、[redirect判定の公式実装](https://github.com/supabase/auth/blob/master/internal/utilities/request.go)、[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow)。changelog.mdは今回取得エラーで差分未確認。インストール済みSDKの実コードと上記公式資料、モック試験で対象動作を確認した。

## B回復メール・パスワード変更の実測（2026-10-17 JST）

本人からB宛て回復メール1通の最終承認を取得。新DB/既存B/確認済み2名/Aセッション1/Bセッション0/価格無効/trial OFFを再照合して実行した。

- 00:33:18 JST: 正規 `/auth/v1/recover` が200、Bだけ1回。MailerSendの最新 `Reset your password` が保存済みBと一致しDelivered。累計4通（登録A/B各1、B登録確認再送1、今回回復1）。追加送信・signup・自動再送なし。
- 00:36:11 JST: 本人が同じアプリ内ブラウザープロファイルで開き、PKCE token交換200、BのgetUser200、回復画面表示。Auth UUID不変、Bセッション1、Aセッション1。最初のパスワード保存操作はまだ `reset-b` 段階だったため入口で拒否し、外部へ送っていない。
- 回復状態を確認して `password-b` に進め、本人が新しいパスワードを保存。00:40:38 JSTにBの `/auth/v1/user` PUT200。本人とUIの「パスワードを更新しました」を確認。パスワード値は取得/保存/出力していない。
- **後続のglobal logoutは未成功**。ローカルfetch中継がSDKの本文なしPOSTをJSON解析エラーとして止め、外部 `/logout` は呼ばれなかった。SDKはエラー時でもブラウザーのセッションを消すためUIは未ログインだが、DBのB回復セッション1件は残存。アプリのupdate処理はsignOut戻り値のerrorを確認していないため、更新成功表示だけで失効まで成功とみなさない。本体処理は今回は変更していない。
- 通信中継を本文なし正規logoutに対応するよう修正。URL/段階/B JWT検証は維持。インストール済みSDKを実際のfetch hookに通す4件を追加し、モックだけでは漏れていたこの失敗を再現・修正した。無関係な空POST、不正JSON、旧DB/Stripeは拒否。
- Bが新しいパスワードでログインした後の復旧用に、`b-recovery-cleanup` 段階を追加。B本人のgetUserとglobal logoutだけを許可し、A/サービスキー/パスワード再変更/メール/他の書込は拒否。専用パネルの「Bの再設定セッションを終了」で、残った回復セッションとその検証ログインを終了する計画。管理者Auth APIやSQLによる失効は使わない。結果は別途DB/レスポンスで確認し、現在は未実施。

635件成功（627+通信4+復旧制御4）、外部33件未実施。lint/型チェック、専用コピーbuild、Docker HTTP16成功。初回の新規テスト型宣言に型エラーがあり修正後に全件再実行した。パスワードlogin、Mac保存確認、B残存セッション終了、A/B本人JWTによる実RLSと後続セッション検証は本人ログイン待ち。Aの既存セッション/実ユーザー数は維持。


## Bパスワードログイン後の検証と安全停止（2026-10-17 JST）

本人から新パスワードでのログイン成功とMac「パスワード」への保存完了を確認。01:30:10 JSTに新DBへのpassword token交換200と既存認証フローのclaim_anonymous_diagnoses RPC200を観測。Bの既存UUIDは維持され、profileが作成された。相談データの引き継ぎや投入は実行していない。

- 01:34:32 JST、B本人JWTによるprofilesの実RLS検証成功: 自分1件、A0件、全件照会でも自分の行のみ。
- 01:34:43 JST、Bの実refresh成功: user不変、refresh tokenのローテーションあり。秘密値は記録していない。
- 続くAのRLS検証はローカル認証確認で失敗しSTOPを作成。Aの操作に対応する新しい外部Auth/RLSリクエストは中継記録にない。ブラウザーの値を読み出さない専用表示で、AのChromeから認証Cookieが送られていないことを確認。Cookie欠落の原因は未特定。DBのAセッション1件が存在することと、ブラウザーから利用できることは区別する。
- 指定された停止条件に従い、Aの再ログイン・Cookie操作・logout、Bの再設定セッション終了・無効token・logout後検証は続行していない。STOPを維持。ユーザー/セッション削除・追加メール・予約記録の削除やリセットなし。
- 事後DB読取: Authユーザー2/認証済み2、Aセッション1、Bセッション2（回復時1＋password login1）、profiles2。診断/購入/契約0、migration17、価格6/active0、trial OFF、service_roleからauth.users直接SELECT不可。
- B回復セッションの終了は未完了。前項のpassword update後logout失敗で残った回復セッションと、今回のlogin sessionは、承認済みのB本人JWT限定global logoutで終了できる準備があるが、今回はA検証停止後に実行していない。Aの元セッションは対象外。
- 今回メール送信0。既存累計4通（登録2、B確認再送1、B回復1）の記録を維持。今回MailerSendの配送画面は再照合していない。
- 635ローカル自動テスト/HTTP16/build/lint/typecheckの直前成功記録は維持。コード変更なし。コミット35c83807dfaf584602dee73c37afe6ea0535a773のCI run38926857990は失敗: ECRの `toomanyrequests: Data limit exceeded` でDockerイメージ取得不可。失敗をskipや成功に置き換えない。外部33件は未検証で、今回の実Auth/RLS個別検証とは別集計。

次の再開手順は、Aの認証開始時プロファイルを本人と確認し、必要ならそのプロファイルで通常loginする（メール/登録不要、元のDBセッションをglobal logoutしない）。その後にA本人JWTのRLSとrefresh、B限定の残存回復セッション終了と再ログインを行う。今回は再試行せず、原因とこの復旧案を報告して停止する。相談履歴の所有権は合成データ未投入のため未検証。STEP9全体は未完了。


### A通常ログイン後の再開（2026-10-17 JST）

Aの元ブラウザーは本人も不明。元のDBセッションを維持し、CookieのないChromeで既存Aへ通常password loginを本人が実行。01:55:54 JSTにtoken交換200。Authユーザーは2件不変、A元セッション1＋今回追加1、Bセッション2。

- A本人JWTのprofiles RLS: 自分1件/他人0件/全件検索も自分のみ。Bの先行成功と合わせ、双方向のprofile分離を実確認。
- Aのrefresh成功、本人不変、Refresh Tokenローテーションあり。A/Bの署名改変tokenはどちらもAuth user endpointが403で拒否。
- 01:58:00 JST、B専用段階でB本人JWTのglobal logout成功。回復セッションとpassword login sessionがともに終了しB0件、Aは2件のまま。BのAuthユーザーは削除していない。
- Bログアウト後: Access Tokenの時刻上の残期限あり、Auth user endpoint403、Refresh Token交換400。JWTの署名/exp自体が即無効になったとの主張はしない。ログアウト後のREST RLSにおける残存JWT利用可否は今回未検証。
- 続いてAは既存アプリのlocal scope logoutで今回追加したセッションだけ終了。UI成功、DBは元のAセッション1件のみ残存。AもAuth user endpoint403、Refresh Token交換400を確認。
- A/Bの再ログインと別ブラウザー検証を一度に行うため、ログアウト済みChromeに保存済みB、ログアウト済みアプリ内ブラウザーに保存済みAを入力。本人のパスワード入力待ち。以後は従来のブラウザーとA/Bラベルの対応が逆になるため、Supabase getUserと保存済みUUIDで再照合する。
- 今回メール送信0。予約記録は全保持。匿名AI、決済、相談データ投入、他環境への接続なし。コード変更なし。
- ebc3d15のCI run38933353522もECRのDockerイメージ転送上限で失敗。ローカル635件/HTTP16の成功と区別する。


### 別ブラウザーの再ログイン結果と停止（2026-10-17 JST）

本人から「Bは成功、Aは失敗」。再試行せず読み取り調査した。

- 02:09:09 JST、Chromeから保存済みBへのpassword login200。getUser200、既存認証フローRPC200、診断照会200。UIも「ログインしました」。Bの別ブラウザーでの再ログイン成功を確認。
- 02:09:24 JST、アプリ内ブラウザーから保存済みAへpassword login400。宛先はローカル許可リストのAに一致。新Supabaseの同じ1分間のAuthログに `Invalid login credentials` が1件、rate-limit一致0件。秘密値を含まない集計だけを取得した。
- 想定外の認証失敗により中継がSTOPを作成。画面の `STEP9_BLOCKED` は安全停止を示す。入力パスワードの値は読んでいないため、誤入力/自動入力の取り違え等の詳細原因は断定しない。PKCEメールリンクの再失敗ではなく、通常password loginの拒否。
- 事後DB: Authユーザー2/確認済み2、A元セッション1、B新セッション1。Aの元のセッションを失効させていない。価格active0、trial OFF。
- 今回追加メール0、再試行0、ユーザー作成/削除/パスワード変更0。既存DB・Stripe・OpenAI・Previewへの操作なし。STOPと全送信予約記録を保持。
- Bの再ログイン/別ブラウザーは成功。Aの別ブラウザーログイン、Cookie削除後の実動作、相談データの所有権は未検証。A/Bの先行RLS/refresh/署名不正拒否/logout後refresh拒否の成功は維持するが、STEP9全体は未完了。
- 復旧案: 本人がA用の保存済みパスワードを確認し、Aだけ通常ログインを1回再開する。パスワードが確認できない場合は、その時点でA向け再設定の必要性と1通送信を別途承認する。現在は再送/再設定を提案だけで実行しない。


## A専用パスワード再設定の準備（2026-10-17 JST、送信未承認）

本人がAパスワード不明と回答し、A既存セッションの終了を許可して再設定を準備する方針を承認。これは**送信の最終承認ではない**。既存A UUID/アカウントは維持し、Bは更新/失効対象外。新規登録・削除・管理者password updateは使わない。

- 既存Bの再設定規則を共通factoryへ移し、固定されたA/BそれぞれのUUIDと段階/台帳を分離。Bの公開インターフェース、既存の予約ファイル名と内容は維持。Aにのみ `reset-a-prepared` → `reset-a` → `password-a` を使用する。本体アプリ/SQL/クラウド設定は変更していない。
- `reset-a-1.approved` は最終承認後だけ作成する。対象Project/既存A UUID/保存済みA宛先ハッシュ/1通/短い期限を照合し、送信前に `reset-a-1.reserved` を排他的作成・fsync。結果不明でも枠を戻さず再送不可。Bの承認記録ではAへ送信できない。現在Aの承認/予約ファイルはどちらも存在しない。
- Aの送信段階はPKCE S256の新verifierを永続化し、Aの予約challengeと一致する場合だけコード交換。B/古いverifierを拒否する。本人入力後のpassword PUT/global logoutはA本人JWTに限定し、B/サービスキー/第三者を拒否する。
- Aが準備に使用するブラウザーは**アプリ内ブラウザー**。送信後も同じプロファイルで、最新回復メールのリンクを他のブラウザーで先に開かず1回だけ操作する。本人がパスワードを入力・Macへ保存・送信し、PUTとglobal logoutの両応答とDBのAセッション終了を確認する。アプリ側はsignOut errorを無視する既知事項があるため、表示だけで終了成功とは扱わない。JWTは時刻上の有効期限が残り得る。
- Aの前回失敗のSTOPは記録を残して保存し、準備段階のみ再開。実ローカルHTTPでreset/signup/resend/login/logout/updateを各403、外部要求増分0、メール予約0を確認。新DB: Auth2/確認済み2、Aセッション1/Bセッション1、価格active0/trial OFF。本人許可のAセッション終了も、まだ実行していない。
- MailerSend Sandbox: 提供テストドメインverified、送信4/配送4/拒否0。open/click/content/unsubscribe追跡は未選択。追加送信0、追加契約0。以前の無料月100通条件に対して4通使用、送信時は残枠を再確認する。Supabaseメール上限は既存30通/時のまま（今回変更なし）。
- 既存635＋新規10＝**645自動テスト成功**。外部33件は未実施として分離。lint/typecheck成功、外向き通信禁止かつ秘密鍵なしの専用コピーでNext.js build成功。Docker HTTP16/初期化29成功、実外部接続0。最初のbuild準備は `.env.example` を実設定ファイルと誤判定して停止したが、例示ファイルのみ許可する確認に直して実ビルドを完了した。実.envは不使用。

最終承認対象は、保存済みAへの回復メール**1通だけ**。Bへ送らない、新規登録/自動再送なし。ユーザーが承認するまで、承認ファイル生成・送信段階への切替・回復API実行はしない。Aのセッション終了は本人password更新後、Bセッションが維持されたことと併せて検証する。

公式確認: [回復メールAPI](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)、[signOut](https://supabase.com/docs/reference/javascript/auth-signout)。changelog.mdはブラウズ取得時の形式エラーで未確認。API仕様は公式ページとインストール済みSDKの合成応答テストで照合した。
