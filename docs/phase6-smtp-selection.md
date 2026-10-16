# Phase 6 STEP 7 — 無料SMTP選定・実認証テスト再開準備

確認日: 2026-10-16。対象は `ukdzggjfkcwjssjmnqim` / `yorisoi-integration-test` のみ。
今回は公式資料の調査、新Supabaseの読み取り、ローカル計画チェックだけを実施する。SMTP登録、資格情報発行、実ユーザー作成、メール送信は未承認・未実施。既存DB、Stripe、Preview、migration、アプリの認証処理を変更しない。

## 1. 選定

**MailerSendのSandboxモードを推奨する。** 独自ドメイン未定の状態で異なる2宛先のSMTP認証メールを検証する要件に最も合う。

| 候補 | 無料枠・期限 | 独自ドメインなしでの今回の適合性 | 判断 |
| --- | --- | --- | --- |
| MailerSend Sandbox | 月100通、2宛先、期限なし。カードなしでSandboxを選択可能 | 提供テストドメインでSMTP利用可能 | 採用候補1つに決定。実アカウントの条件確認は作成承認後 |
| Brevo Free | 1日300通、カード不要、期限なし | 送信者メールのコード認証経路はあるが、SMTPガイドはドメイン認証を案内。無料メールのドメイン認証はできず、提供テストドメイン方式は確認できない | 送信ドメイン確保後の代替候補 |
| Resend Free | 月3,000通、1日100通、SMTP対応 | `resend.dev` はアカウント本人のメールに限定。他の宛先には独自ドメイン認証が必要 | 現状のA/B検証には不適 |

出典: [MailerSend Sandbox](https://www.mailersend.com/help/sandbox-mode-and-the-professional-trial)、[テストドメイン](https://www.mailersend.com/help/getting-started)、[Brevo Free](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan)、[Brevo SMTP](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP)、[Brevo送信者認証](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email)、[Resend料金](https://resend.com/pricing)、[Resendテストドメイン制限](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)。

### 無料利用で混同してはいけない点

- Sandboxモードと14日間のProfessional trial、別のFreeプランを区別する。料金ページのFreeプランは月500通・承認とカード登録が必要と案内されている。今回選ぶのはカードを登録しないSandboxモード。試用や課金プランへ自動的に進まない。[料金ページ](https://www.mailersend.com/pricing)
- Sandboxアカウントの月100通と、提供trial domainの「最大100通・異なる2宛先」は別の制限として扱う。trial domain側の100通が毎月復活するとは保証しない。今回の2通＋別承認の再送最大2通には十分だが、利用開始時に残枠を再確認する。
- 第三の宛先へ動作確認メールを送らない。A/Bだけを2つのユニーク宛先枠に使用する。メールボックス所有・宛先正確性は送信直前に本人が安全な入力画面で再確認する。
- 新規MailerSendアカウント自体の登録確認メールは、Supabaseの2通とは別に発生し得る。登録先とそのメールの受信もアカウント作成承認に含める。
- 本日の追加費用は0。推奨構成も公式条件では0ドル。実アカウントは未作成のため、作成画面で有料契約・カード・有料審査等が要求された場合は停止して再報告する。

## 2. SMTP設定案（未登録）

| 項目 | 設定案 |
| --- | --- |
| 専用アカウント | よりそい結合検証専用。既存アカウント・ドメイン・鍵を流用しない |
| 送信ドメイン | アカウントに提供される実際のtrial domain。作成前なので値は未確定 |
| Host | `smtp.mailersend.net` |
| Port | `587` |
| 暗号化 | STARTTLS、TLS 1.2/1.3、証明書検証必須。平文へのフォールバック禁止 |
| Username | テストドメインのSMTP画面で生成されるSMTPユーザー名。ログインメールとは別 |
| Password | 専用SMTPユーザーの生成パスワード。APIキーで代用しない |
| From | `auth@<実際の提供テストドメイン>`。プレースホルダーのまま登録しない |
| Sender name | `よりそい検証` |
| トラッキング | 開封・リンク追跡をOFF。認証URLの書き換えを避ける |

[MailerSend SMTP公式](https://www.mailersend.com/help/smtp-relay)は587/STARTTLS、trialでのSMTP利用、SMTP枠とAPI枠の共有を説明している。SMTP資格情報はドメイン単位ではなくアカウントの認証済みドメインにまたがるため、専用アカウントと1つのSMTPユーザーで分離する。

[Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)は任意のSMTPサービスに対応する。したがってプロトコル上は互換性があるが、MailerSendからの実配送・迷惑メール分類・Supabaseとの実接続は未検証。

秘密情報はMacの「パスワード」またはキーチェーンの専用項目 `yorisoi-integration-test / MailerSend SMTP` で保管する計画。新規資格情報の入力・保存操作は本人が行う。Supabase側に登録するSMTPパスワード以外に、MailerSendのAPIキーは不要。アプリやVercel、Git、コマンド引数、ログ、スクリーンショットにSMTPパスワードを入れない。現在のSupabase用ローカル鍵は既存のGit管理外・権限0600保管を維持し、MailerSendへ渡さない。

## 3. 読み取り確認した新Supabaseの状態

2026-10-16、MCP `get_project` と対象Project Refを含むDashboardで確認。設定の保存操作はしていない。

| 項目 | 確認結果 |
| --- | --- |
| Project / Organization / Region | yorisoi-integration-test / AI Fortune / ap-northeast-1 |
| 状態・プラン | ACTIVE_HEALTHY / Dashboard表示FREE |
| DBホスト | `db.ukdzggjfkcwjssjmnqim.supabase.co` |
| Custom SMTP | OFF |
| Email provider / Confirm email | ON / ON |
| 新規登録 | ON |
| 匿名サインイン / 手動リンク | OFF / OFF |
| Site URL | `http://localhost:5198` |
| Redirect URL | `http://localhost:5198/auth/callback` の1件、ワイルドカードなし |
| パスワード | 大文字・小文字・数字・記号。最小12文字はSTEP 6の記録。今回のUIでは長さの値が伏せられるため再取得していない |
| Email OTP | 3,600秒、8桁 |
| メール送信レート | UI項目は変更不可・数値は伏せられる。標準SMTPの公式上限は2通/時。値を読み取ったと扱わない |
| Custom SMTPの同一ユーザー間隔 | UI表示60秒（現在は無効状態） |
| Token refresh / verification / signup-signin | UI表示150 / 30 / 30リクエスト・5分・IP単位 |
| JWT・Refresh Token | 今回未変更。設定変更直前の再記録対象 |

標準SMTPはチームメンバー宛先のみであり、前工程の確認ではA可・B不可。今回は宛先を外部サービスへ送っていない。Custom SMTP導入時の標準初期レートは公式上30通/時だが、これを送信承認と解釈しない。実行計画は2通/時以内、初回2通までを維持する。設定切替によるレート変化も差分として記録し、必要な制限調整は承認範囲に含める。

## 4. 承認後の設定・復旧手順

1. MailerSend専用アカウント作成の承認を取得し、登録先・規約・0ドル・カード不要のSandboxを実画面で確認。登録確認メールの送信先も承認対象にする。
2. 実際のtrial domain、残通数、2宛先制限、SMTP利用可能状態を確認。承認後にSMTPユーザーを1つ発行し、本人が安全に保管。別のテスト送信はしない。
3. 新SupabaseのProject Refを再確認。変更前のSMTP ON/OFF、非秘密設定、Authレート、Site/Redirect、メール確認、JWT/Refresh設定を秘密情報なしで記録する。既存SMTP秘密値が新たに存在した場合は上書きせず停止する。
4. 別承認後、新プロジェクトのAuthentication → Email → SMTPに上記値を登録。その他のAuth設定は維持。登録だけの確認でメールを送らない。
5. local 5198の認証テスト専用許可を準備・レビューし、初回2通の承認前は送信遮断を維持する。
6. 問題発生時はローカル実行を停止し、新規送信を遮断。承認範囲内でCustom SMTPをOFFに戻し、記録した設定との差分を復元する。資格情報の失効は対象SMTPユーザーだけに限定する。既存DBの復元やresetは行わない。

SMTP受付後のメールや配送再試行は、設定OFF・資格情報失効で取り消せるとは限らない。復旧は新規受付を止める操作であり「送信取り消し」ではない。Authユーザー削除はSMTP設定復旧と分離し、別承認の上、今回作成したUUIDと関連行だけを確認して実施する。

## 5. ローカルコード監査と再開前に必要な準備

- `src/app/api/auth/route.ts`: Origin検証、12文字＋文字種検証、IP/セッション/メール単位の利用制限、Supabase Authによる本人確認を維持。signupを再送代わりに反復しない（signupはIPあたり3回/日のアプリ制限もある）。
- `src/app/auth/callback/route.ts`: PKCE code交換後、確認済みユーザーを検証する。確認リンクは**登録を始めた同じブラウザープロファイル**で開く。別ブラウザーの検証は認証済み後の通常ログインで実施する。
- callback/loginは `claim_anonymous_diagnoses` を呼ぶ。空のテスト環境でもプロフィール作成が発生し得る。Authだけの書き込みだと誤認しない。今回準備する認証は匿名AIの `trial_claim` 検証とは別工程。
- 現在のSTEP 6環境はAuth POST/callbackを遮断し、外向き通信も限定GETのみ。プロキシは実ユーザーJWTによる通信にもまだ対応していない。SMTPの設定だけでは再開できない。
- 次工程で専用実行経路をレビューする。許可対象は新Supabaseのsignup、password/PKCE/refreshのtoken交換、logout、確認フロー、必要な `consume_limit` / `claim_anonymous_diagnoses` に限定。ユーザーJWTは新プロジェクトのAuthで検証し、全POST許可やservice_roleのブラウザー公開をしない。verifyがGETでもAuth状態更新を伴うため書き込み承認対象。
- `scripts/auth-live.mjs` はHosted DBに向けて実行禁止を維持。CSRF、PKCE、Secure Cookie、RLSを緩めて成功扱いしない。localhostのSecure Cookie挙動は実ブラウザーで別途確認する。
- 今回追加の `checkInitialAuthMailPlan` はオフラインの計画チェックだけ。初回A/B各signup1件のみを受理し、再送や3件目を拒否する。送信器、承認取得、実送信数の強制機構ではない。
- 再開する実行器には単一実行者・永続台帳を用意し、送信前に試行枠を予約。失敗・通信断・結果不明も消費済みとして停止し、台帳を初期化して再送しない。記録はA/Bラベル、時刻、試行ID、結果区分のみ。物理的な重複配送まで絶対保証はできない。

## 6. 実メール認証テスト計画（未実行）

| 段階 | 操作と合格条件 | メール・書き込み |
| --- | --- | --- |
| 直前確認 | 保存済みA/Bが本人管理下の異なる2宛先であること、対象Ref、SMTP枠、現在0ユーザー、送信台帳を確認。本人に件数と削除計画を提示して停止 | なし |
| A登録 | A用ブラウザーで新規登録。未認証の保護操作拒否を確認 | signup1回、確認メール1通予定 |
| A確認・ログイン | 本人がメールを受信し同じプロファイルでリンクを開く。確認済み・ログイン状態を検証 | Auth確認・セッション・プロフィール等 |
| B登録・確認 | B用の独立プロファイルで同様に実施 | signup1回、確認メール1通予定 |
| セッション | logout後の拒否、別ブラウザーで通常ログイン、refreshで更新、無効トークン拒否を確認 | セッション等。追加メールなし |
| 所有権 | A/Bプロフィール等の認証済みアクセス分離を確認。相談が0件なら相談所有権を実証済みとしない | 相談fixture未投入 |
| 再送候補 | 必要性と実際の送信状況を調査して停止。最大2通を別承認。同じ宛先は60秒以上、保守的な2通/時も守る | 自動再送しない |
| 終了 | 作成UUID・行種別・送信試行数を秘密情報なしで記録し、削除対象と方法の承認を取得 | 無断削除しない |

初回はAuthユーザー2人、Auth確認メールA/B各1通・計2通。予定されるDB更新は `auth.users`、identities、sessions、refresh tokens、Auth監査ログ、アプリの利用制限・プロフィール、既存引き継ぎRPC（空データなら診断・購入の移動0件）。相談データ投入・AI生成・決済は含まない。ログアウトは現実装のlocal scopeであり、他ブラウザーの即時全失効を成功条件にしない。既発行JWTの有効期限も区別する。

メール本文・確認リンク・パスワード・トークン・宛先実値をログやGitへ記録しない。MailerSendのActivity保持が短い（Sandboxでは1日）ため、必要な配送結果だけをA/Bに置換して当日記録する。受信は本人に確認し、未着を成功扱いしない。

他人の相談履歴・匿名相談引き継ぎ・二重引き継ぎ・24時間失効のHosted検証は、実認証の成功後、合成データ投入を別承認して行う。現時点のDocker/HTTP証拠と区別する。外部33件は今回実行せず未検証を維持する。

## 7. 変更と検証

変更対象はこの計画書、旧計画からの参照追記、`scripts/phase6/auth-preparation.mjs`、`tests/auth-initial-mail-plan.test.ts`。アプリ、migration、CI設定、クラウド設定の変更なし。

初回計画に関する9テストを追加。既存準備・ローカル遮断との対象テスト52件、全自動テスト553件、lint、型チェックが成功。外部33件は既存の未実行区分のまま（成功に含めない）。入力画面のPython8件は最初の制限環境では待受けできず失敗し、ループバック待受け可能な環境で再実行して8件成功。テストや安全条件は変更していない。ビルド・Docker/HTTPを含む対象コミットのCI結果は完了報告に記載する。既存テストの削除・skip追加は行わない。

次に必要な承認は、(1) MailerSendの0ドルSandboxアカウント作成と登録確認メール、(2) SMTP資格情報発行・保管と新SupabaseだけへのSMTP登録、(3) ローカル実認証の限定通信とA/Bユーザー2人作成・確認メール計2通・関連DB書き込み。再送、相談fixture、削除はそれぞれ明示承認する。今回はここで停止する。
