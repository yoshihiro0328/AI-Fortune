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
