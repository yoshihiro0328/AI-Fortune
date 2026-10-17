# Phase 6 STEP 10 固定SQL投入・Hosted所有権検証

2026-10-17。基準コミット `156be1908c64bf77e075b20c353cf93f273ba824`、ブランチ `codex/yorisoi-phase6-redesign`。

**承認された固定SQLを1回送信して12行を作成し、実Supabase・本人JWT・実アプリAPIによる14検証グループが成功した。12行を残したまま停止した。** 秘密情報を除いた機械可読結果は [検証記録](phase6-step10-hosted-results-20261017.json)。既存外部33テストとは別の専用検証であり、33件を成功へ変更していない。

## 対象・固定SQL・送信記録

- 唯一の接続先は `yorisoi-integration-test` / `ukdzggjfkcwjssjmnqim`。管理APIで `ACTIVE_HEALTHY`、DBホスト `db.ukdzggjfkcwjssjmnqim.supabase.co` を実行直前に確認した。
- 固定ファイルはGit管理外の `private-step10/repair-01/complete.sql`。SHA256は **`faf7ec38fd9fa3a38edeac2bd4c94f5a609fca25520da84a82911810fb27000e`**。
- 保存済みバイト列を検証証明・manifest・元の12UUID・A/B UUID・匿名ハッシュと照合した。再生成・本文変更はしていない。
- `private-step10/hosted-02` に新しい実行予約を排他的に作成し、前回の予約記録のSHA256へ紐づけた。予約後に従来と同じSupabase SQL実行ツールで1回だけ送信。成功後のUUID照合も完了した。
- 前回の失敗SQL、予約、STOP、manifest、暗号化バックアップ・復旧計画は変更前後のSHA256一致を確認した。旧失敗を成功扱いに書き換えていない。
- SQL本文・12UUID・匿名ハッシュ・Cookie・JWT・メール・パスワードは公開報告に含めない。今回の作業でこれらをGitへ追加していない。

## 投入前後の状態

| 対象 | 投入前 | 最終状態 |
|---|---:|---:|
| consultation_subjects | 0 | 2 |
| consultation_threads | 0 | 2 |
| consultation_turns | 0 | 2 |
| diagnoses | 0 | 2 |
| diagnosis_answers | 0 | 2 |
| free_reports | 0 | 2 |
| Authユーザー／認証済み | 2 / 2 | 2 / 2 |
| profiles | 2 | 2、内容不変 |
| Authセッション | 3 | 3 |
| payments / subscriptions / billing_customers | 0 / 0 / 0 | 0 / 0 / 0 |
| ai_calls / consultation_ai_calls | 0 / 0 | 0 / 0 |
| 有効価格 | 0 | 0、全6価格不変 |
| migration | 17 | 17 |
| RLS有効テーブル | 42 | 42、ACL・ポリシー不変 |
| 匿名AI | OFF | OFF |
| rate_limits | 22 | 26、元22行不変 |

投入前にprofiles fingerprint、Auth UUID、FK15件、対象テーブルのアプリトリガー0件、関連テーブルの空状態を確認した。ACL比較では旧記録の文字列形式と今回の配列形式を同じ表現に正規化した。実際の権限差分はなかった。

Stripe環境は `sandbox` / `acct_1UQlQdI73kTcvXz8` のまま。service_roleによる `auth.users` の直接SELECTは引き続き禁止。Auth確認関数・claim権限、Authユーザーの内容、profiles内容は投入・引き継ぎの前後で不変だった。

## 実Supabaseで成功した検証

| 検証 | 実行結果 |
|---|---|
| 本人JWTのRLS | anonキー＋A/B本人Access JWTで相談相手・スレッド・ターンの自分の行だけを取得。全件取得でも本人1行、他人のID指定は0行 |
| 未ログイン・不正JWT | 対象6テーブルへの直接取得を401で拒否 |
| 実アプリ相談API | `GET /api/consultations` の一覧・本文で本人データのみ取得。他人のスレッド指定は404 |
| 実アプリ未認証 | 未ログイン・不正認証Cookieの一覧・本文取得は401 |
| 引き継ぎ前の匿名診断 | A/BそれぞれのCookieで本人側だけ200。相手側・偽造Cookieは404。会員JWTだけでは未引き継ぎ診断・回答・レポートは0行 |
| 直接claim RPC | anonは401、A/Bの一般ユーザーJWTは403。service_roleの読取をRLS成功として扱っていない |
| CSRF・偽造Cookie | CSRF違反は403。偽造匿名Cookieのclaimは0件で、所有者NULLを維持 |
| A/Bの正規引き継ぎ | 実アプリ `POST /api/auth` の `action=claim` から各1件成功。所有者UUIDは各本人へ一致 |
| 任意の引数混入 | 本文に相手のuser_id・匿名ハッシュを混入しても無視され、本人認証と実Cookieが採用された |
| 同時・再引き継ぎ | Aの引き継ぎ成功後の同時2要求はいずれも0件。その後の本人・別アカウント再実行4要求もすべて0件 |
| 引き継ぎ後の分離 | 診断・回答・レポートも本人JWTだけで取得。実APIで他人は404、旧匿名Cookieも404 |
| 所有者変更 | A/Bそれぞれの本人JWTで相談相手・スレッド・ターン・診断のuser_id変更を計8回試行し、すべて403。直後のDB読み取りで所有者不変を確認 |

14グループは、認証・初期件数確認を含めて専用実行器で1回だけ実行した。実行器の完了後にDBを読み直し、件数・所有者・副作用を別途照合した。意図した拒否応答を除き、Hosted実行エラーはなかった。

## 許可された副作用・通信

- 12行のINSERT後、診断2行の `user_id` と `updated_at` だけが変わった。診断の他フィールドと残り10行は不変。
- rate_limitsは今回の専用IPキー1件と匿名セッション3件の計4行を追加。カウントはIP=9、A=5、B=3、偽造Cookie=1。既存22行・制限値・期限の初期化はしていない。`consume_limit` 呼び出しは18回。
- A/Bの通常refreshを承認範囲で各1操作実施。期限切れ状態の `getUser` 内更新と明示refreshにより、tokenエンドポイントは計4回200、user確認は計2回200。失敗の再試行ではない。ユーザーID・セッション数3を維持し、失効・新規登録・削除はしていない。refresh後から投入・claim完了までのAuthユーザーfingerprintも一致した。
- STEP10中継には新Supabaseだけの計180要求（本人認証保存時2要求を含む）。パス・メソッド・結果のみを記録し、本文・クエリ・資格情報は通信ログへ出していない。
- アプリと実行器はOS側でも外部通信を遮断し、127.0.0.1の専用中継だけを許可。中継は指定新Supabaseの必要なGET、承認済みRPC、12UUID限定の拒否期待PATCHだけを許可した。
- 旧DB・Stripe・OpenAI・signup/resend/recoverの禁止要求が外部転送前に拒否されることを確認。メール送信、AI生成、決済、相談生成POSTは実施していない。
- 現行アプリソースは基準コミットと一致することを確認し、既存.env.localを含まない専用ビルドを使用。アプリ・migration・権限設定は変更していない。
- 完了後は今回起動した5206/5208/5209の検証プロセスを停止した。既存5198の認証環境、A/Bセッション、既存Previewは維持した。

## 残存12UUIDとクリーンアップ計画

Git管理外の `private-step10/hosted-02/cleanup-inventory.json` に元manifestの12UUID、現所有者、関連FK15件を保存した。親ディレクトリ0700、機密ファイル0600、元の固定SQL・検証証明0400。実行前後状態はAES-256-GCMで保全し、復号・照合できることを確認した。

対象は上表6テーブルの各2行だけ。相談相手→スレッド→ターン、診断→回答・無料レポートの対応と所有者を確認した。課金・有料レポート・AI呼び出し・診断分析・選択質問・アフィリエイト・相手と診断の関連・trial contextの想定外行は0件。

**今回DELETEは未実施。** 別途承認後は次の順序とする。

1. 新Project Ref・ホスト、12UUID・所有者・関連FKを再確認し、その時点の暗号化バックアップを別名で保存する。
2. 全対象・依存テーブルを同一トランザクション内でロックし、想定外の子行・FK変更・件数差分があれば削除前に停止する。
3. manifestのUUIDだけを条件に、ターン→スレッド→相手→診断回答→無料レポート→診断の順で削除する。暗黙cascadeで未知の行を削除しない。
4. 対象UUIDが各0、Authユーザー2、profiles2・内容不変、rate_limits不変、決済・契約0を確認して終了する。

Authユーザー・profiles・rate_limitsは削除対象外。全件削除・TRUNCATE・DB reset・既存DBの復元は禁止。失敗やCOMMIT結果不明なら再実行せず読み取り確認して停止する。UUID限定cleanupと未知の子行の拒否は前工程のDocker検証済みだが、Hosted cleanupは未実施。

## 品質・未検証範囲・次の承認

今回、実装・テストコード・固定SQLは変更していない。基準コミットの[CI 39004877409](https://github.com/yoshihiro0328/AI-Fortune/actions/runs/39004877409)は成功。既存726テスト、lint・型チェック・Next.jsビルド、Docker HTTP16・所有権18・Stripe初期化29・固定SQL20の成功を維持する。今回追加テストは0件。本報告追加コミットのCIは完了報告のリンクで別途確認する。

既存の外部33テストは未実施・未検証のまま。今回の実JWT・Hosted14グループと混同しない。初回claimそのものの競合はDockerでの確認であり、Hostedの同時試験はclaim成功後の重複要求。未認証ユーザーのHosted claim、障害注入・ロールバック、Phase 6匿名AI、Stripe決済、OpenAI生成は今回実施していない。

匿名診断Cookieは所持者を識別する秘密値であり、盗まれた正規Cookieを別ユーザーが初回使用する状況を防ぐ保証ではない。今回確認したのは、異なるCookie・偽造Cookieの分離、正規認証に基づくclaim、引き継ぎ後の所有者固定と旧Cookie拒否である。

次に必要なのは、この結果確認後の**12UUID限定クリーンアップの承認**。データを残して次工程へ進む場合も、その試験の書き込み範囲を別途承認する。第2開発単位、Stripe、OpenAI、Vercel公開へは進まない。
