# Phase 6：Auth権限不整合のローカル修正・再検証

2026-10-15 JST。ブランチ `codex/yorisoi-phase6-redesign`。修正前基準 `2b6eca7743e851b93115e836592c1a332cbeccb7`。

今回の範囲はローカルSQL・テスト・文書・GitHub CIのみ。新DB `ukdzggjfkcwjssjmnqim`、既存DB `rnvrdrfdbapfafwjbygo`、Auth実ユーザー、両Preview、Stripe、OpenAIは変更していない。Supabaseへの接続・SQL適用も行っていない。

## 原因と修正

15/16番の`public.trial_claim`はSECURITY INVOKERで`auth.users`を直接SELECTしていた。実環境のservice_roleはBYPASSRLSを持つが、AuthテーブルのSELECT権限は持たない。この2種類の権限は独立している。以前のDocker/HTTP fixtureがservice_roleにSELECTを追加し、一部DB試験も所有者でRPCを呼んでいたため、不整合を隠していた。

追加した17番：`20261015081652_trial_auth_verification.sql`。既存16件はバイト単位で変更なし。全17件のSHA256・適用順は[manifest](phase6-external-migration-manifest.md)。新ファイルのSHA256は `eba7f238cb6799524062e49e9c4c1fb756ab2eb84c11e69b2d6cbcf1499dea97`。

`trial_private.email_verified(uuid)`だけをSECURITY DEFINERにする。静的SQLで`auth.users`のid/email_confirmed_atを確認し、booleanだけ返す。所有者postgres、空のsearch_path、スキーマ修飾したテーブル名、PUBLIC/anon/authenticatedへのEXECUTEなし、service_roleにだけ明示EXECUTEを付与する。所有者自身の暗黙権限は保持する。private schemaのAPIロールによるCREATEも拒否する。

`trial_claim`はSECURITY INVOKERのまま、Auth判定の1箇所だけをこの関数へ置換する。所有者・セッションのロック、期限、削除状態、他人への引き継ぎ拒否、同一本人の再送、トランザクション、利用枠・履歴処理は維持する。AuthテーブルのGRANTやRLSは変更しない。

HTTP層は従来どおり`auth.getUser()`で本人を確定し、認証済みメール・明示同意を検証する。クライアントのuser_id、p_user、email_confirmed_atを受け付けず422で拒否。DBでも認証状態を再確認する。専用関数だけでJWT本人性を証明する設計ではなく、service_roleを持つサーバーと検証済みAuth応答が信頼境界になる。

| 案                              | 判断                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| service_roleへAuth SELECTを追加 | 不採用。アプリ全体のAuth読取権限が広がる                     |
| trial_claim全体をDEFINERにする  | 不採用。相談履歴・所有者更新まで所有者権限で動く             |
| HTTPの認証フラグだけで判定      | 不採用。DB内で認証状態を再確認する要件を満たさない           |
| private boolean関数だけDEFINER  | 採用。昇格する処理を静的Auth確認に限定し、DB内判定を維持する |

専用DBロールを新設する案もあるが、Auth ACL・ロール管理を追加変更する必要がある。今回は既存の信頼済みpostgresの必要権限を事前条件として確認し、限定関数だけを所有させる。postgresは強い所有者なので、将来この関数へ動的SQLや追加データ返却を入れない。参考：[PostgreSQL CREATE FUNCTION / SECURITY DEFINER](https://www.postgresql.org/docs/current/sql-createfunction.html)。

## 権限比較とDockerの再現範囲

| 項目                            | 修正前の実環境 / 旧Docker   | 修正後のローカル検証                          |
| ------------------------------- | --------------------------- | --------------------------------------------- |
| service_roleのauth.users SELECT | 実環境なし / Dockerあり     | なし。直接SELECTが権限エラー                  |
| auth.users RLS                  | 実環境ON / Docker未再現     | ON。17番前後のACL・RLS・policy数が一致        |
| trial_claim                     | INVOKERでAuth直読           | INVOKERで限定関数呼出し、所有者postgres       |
| Auth専用関数                    | なし                        | postgres所有のDEFINER、boolean、空search_path |
| PUBLIC/anon/authenticated       | 専用関数なし                | 専用関数EXECUTE拒否、PUBLIC ACLなし           |
| service_role                    | 専用関数なし                | 専用関数EXECUTE可、private schema CREATE不可  |
| publicオブジェクト自動権限      | Dockerでは広いdefault grant | default grantなし。各migrationの明示grantだけ |
| RPC呼出しロール                 | 一部DB試験は所有者          | DB RPCはservice_role、HTTPはPostgREST経由     |

DockerはSupabase PostgreSQL 17.11.0.004イメージ。事前確認のHostedは17.11.0.003で、管理サービス全体の完全複製ではない。初期管理者platform_adminとpostgresを分離し、アプリmigration実行・関数実効所有者のpostgresは**NOSUPERUSER + BYPASSRLS**で検証した。Authテーブル所有者はsupabase_auth_admin。postgresのAuthアクセスはプラットフォームfixtureの設定であり、アプリmigrationには含めない。実行ロール切替権限は検証管理者側にだけ設定する。

初回検証時はbootstrap superuserを降格できない制約と管理者のSET ROLE不足で失敗し、fixtureを修正した。HTTPの不正入力の期待値400を既存仕様の422へ修正した。旧回帰テストのpg_policies集約は順序未指定だったため、内容を減らさずORDER BYで比較を安定化した。失敗した検証をskipで成功扱いにしていない。

## 引き継ぎ10条件

| 条件                  | 検証結果・根拠                                                                        |
| --------------------- | ------------------------------------------------------------------------------------- |
| 1. メール認証済み     | service_roleで成功、本人のsubject/thread/turn/contextへ保存、charged=false            |
| 2. 未認証             | DBでauthエラー、HTTP401。Authモックだけ認証済みにしてもDB未確認なら拒否               |
| 3. 存在しないユーザー | boolean=false、claimはauthエラー、NULLも拒否。履歴・所有者不変                        |
| 4. 他人の匿名相談     | 独立Cookie/別turn IDを拒否。引き継ぎ後の他人の履歴GETは404                            |
| 5. 偽造セッション     | 不正な匿名Cookie、偽造Auth署名を拒否。本文のID/認証フラグによる上書きも拒否           |
| 6. 期限切れ           | HTTP410、読取・再送・引き継ぎ不可、定期削除後も復活しない                             |
| 7. 削除済み           | claim409/conflict、履歴件数不変。削除とclaimの競合は全件転送か拒否のどちらか          |
| 8. 2アカウント同時    | DockerとHTTPで勝者1件、敗者ownership/403。所有者混在・二重履歴なし                    |
| 9. 同じ本人の再送     | 同じthread IDを返す。履歴重複なし、無料枠を消費しない                                 |
| 10. 途中DBエラー      | turn挿入を故障させ、subject/thread/turn/sessionの全スナップショット一致。部分保存なし |

同じ匿名Cookieを2アカウントが保有する競合では、最初に正しく引き継いだアカウントが所有者になる。匿名Cookie自体の漏洩をDBが判別できるという保証ではない。Cookie・サーバー鍵・認証セッションの保護は引き続き必要。

## 関連SQLの監査

最終状態のアプリ関数定義を検査し、`FROM auth.users`は`trial_private.email_verified`と`public.protect_payment_environment`の2件だけであることを自動確認する。

- 3番の旧診断claimのAuth読取は4番で除去済み。変更不要。
- 11番growth_metricsのAuth読取は12番で除去済み。登録人数は既存Auth Admin API側で取得。変更不要。
- 15/16番trial_claimの直接読取は今回17番で置換。
- 13番protect_payment_environmentはINVOKER。payment_environmentを変更するDB所有者が空プロジェクトを判定する際のAuth読取。service_roleはこのテーブルのSELECTだけで、UPDATEは権限拒否。ユーザー存在後は所有者でも環境ID変更を拒否することを確認。通常の決済APIがAuth SELECTを必要とするトリガーではないため変更しない。
- Authへの外部キーは関数の直接SELECTとは異なり、今回の権限拡張対象にしない。

13番は既存Stripe Sandboxのaccount IDをseedする。SQLだけでStripe通信は起こらないが、新独立SandboxのIDへ別承認で初期化するまで新DBへAuthユーザー・診断・購入を入れない。既存price識別子のUPDATE禁止は維持し、新versionを追加する。旧秘密鍵を新DB/Previewへ持ち込まない。

## テスト結果

| 検証                                 | 結果                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| lint / 型チェック / Next.jsビルド    | 成功                                                                                      |
| 既存Vitest                           | 484件成功、既存試験削除なし                                                               |
| 追加Vitest                           | 17件成功。Auth差分再現、ACL、所有者、boolean、偽造入力、失敗時不変、Stripe guard          |
| Vitest合計                           | 501件成功、外部33件は従来どおり未検証                                                     |
| Docker                               | 17 migration、修正前失敗/修正後成功、Auth/RLS、同時実行、費用台帳、削除、dump/restore成功 |
| HTTP結合                             | 既存16シナリオを維持して強化。16/16成功                                                   |
| 旧1,980円・980円 / 無料3回・Plus30回 | 合成データ不変、引き継ぎで枠を消費しない                                                  |
| 外部サービス呼出し                   | 0件。Auth/Turnstile/OpenAIはモック                                                        |

詳細機械記録：[Docker・HTTP結果](phase6-auth-integration-results.json)。GitHub CIの確定コミット・結果URLは完了報告で示す。同じCIがlint・型・501テスト・build・Docker/HTTP16を実行し、結果をartifact保存する。

HTTPは実Next.js → Supabase SDK → PostgREST → PostgreSQL。Supabase Authの実ログイン、メール、token更新/失効、Hostedの管理ロール全体は未検証。外部33件をローカル成功件数に含めない。推計3ドル制御の並行検証は継続したが、実OpenAI請求の絶対上限保証ではない。

## 変更ファイル

- migration17：限定Auth確認関数とtrial_claimの置換。
- scripts/phase6/auth-bootstrap.sql：共有の制限付きAuth fixture。
- scripts/phase6/docker-verify.py：非superuser所有者、service_role実行、Auth/RLS・監査・巻戻し・競合・復元の検証。
- scripts/phase6/integration.mjs：分離した初期管理者、制限付きAuth fixture、HTTP偽造/DB認証再確認/削除済みclaimの検証。
- tests/helpers/isolated-db.ts、tests/trial-database.test.ts：広いAuth/default権限を廃止、RPCをservice_roleで実行。
- tests/trial-auth-permissions.test.ts：追加17件。
- tests/subscription-end-date.test.ts：policy比較を順序固定。内容の検査は維持。
- 本報告、結果JSON、17件manifest、外部準備計画。修正前の新DB事前確認・作成準備資料も履歴として保存。

アプリ画面、通常認証・決済/Webhook、相談APIのTypeScript実装は変更していない。

## 適用前条件と復旧

**ローカルのAuth不整合は解消。新DBへのSQL適用は、以下の条件を確認し、ユーザーの別途明示承認を受けた後に進める。今回未適用。**

1. 対象を`ukdzggjfkcwjssjmnqim`だけに固定。組織・名称・DBホスト・空のアプリmigration履歴と業務データを再読取確認。既存refは拒否対象。新DBが空でなければ停止。
2. 17件すべてのSHA256をmanifestと照合。順番1→17、migration履歴も対応して記録。postgresのAuth必要2列SELECT・BYPASSRLS・schema権限、service_roleのAuth SELECTなしを直前に再確認。Hosted権限の変化やCREATE FUNCTION拒否なら停止し、権限を勝手に広げない。
3. 新DBだけの適用前スキーマ/ACL/設定台帳と、承認された暗号化dumpを権限制限したローカル保存先へ保管。保存期間・削除担当も承認する。Freeの自動復旧を前提にしない。秘密鍵はGitや報告書へ含めない。
4. アプリ・Cron・外部秘密鍵を接続せず順番に適用する。17番はBEGIN/COMMIT、lock_timeout 5秒、statement_timeout 60秒。SQL/履歴の不一致、ロック待ち、権限失敗があれば後続を止める。17番が失敗してrollbackした場合も、15/16状態でサービスを動かさない。
5. 適用後、42アプリテーブルのRLS、public関数34、private認証関数1、11trial RPCのブラウザー実行拒否、service_roleの直接Auth SELECTなし、helper所有者/DEFINER/boolean/空search_path、claim INVOKER、Auth ACL/RLS不変を確認。匿名AI OFF、全利用データ0、Cron未設定も確認する。実メール・実API試験は別承認。
6. 不明な途中状態に対してmigration repairや再実行、既存DB resetをしない。到達version・エラー・権限差分を秘密なしで記録し、接続を隔離する。17番がcommit済みなら、次の修正migrationを作るか、新テストDBだけを適用前の空状態へ復旧する計画を提示して承認を待つ。動作しない旧claimへ戻して運用再開しない。
7. 再構築/restoreは**新DBのみ**が対象。Hostedのauth/storage管理スキーマをローカルfixtureで上書きしない。Dockerの合成DB dump/restore成功はHosted Auth全体の復旧保証ではない。管理ロール・Auth設定・外部サービス・暗号鍵は別途復旧確認する。再作成でrefが変わる場合は設定・費用も改めて承認する。

次の承認は「新DB限定でmanifestの17 SQLを適用し、停止・復旧方針に従い、適用後の権限を確認すること」。Stripe環境初期化、ユーザー/メール、外部33件、Cron、匿名AI ON、Vercel接続はこの承認に含めない。
