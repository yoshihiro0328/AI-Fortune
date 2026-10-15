# Phase 6 STEP 2：新Supabase DBの適用前最終確認

> この文書は修正前の事前確認記録。Auth権限差異は後続の17番migrationでローカル修正・再検証した。[最新報告](phase6-auth-permissions-verification.md)を参照。実DBへの適用は未承認・未実施。

確認日：2026-10-15 JST。アプリ/SQL基準HEAD：`2b6eca7743e851b93115e836592c1a332cbeccb7`。ブランチ：`codex/yorisoi-phase6-redesign`。

**判定：DB作成・分離・SQLチェックサムは合格。ただしAuth参照権限の差異があるため、SQL適用準備完了とは判定しない。適用は保留。** 今回は新DBに対するSELECT・カタログ参照・ログ照会だけで、DDL/DML、migration、ユーザー作成、メール、AI、決済、デプロイは実行していない。既存DBへのSQL接続も行っていない。

## 1. 新DBの確認結果

| 項目                | 実測・確認結果                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 名称・ref           | `yorisoi-integration-test` / `ukdzggjfkcwjssjmnqim`                                                                             |
| 組織                | AI Fortune / `xypcnfoznewknhiumsqd`                                                                                             |
| プラン・地域        | Free (`tier_free`) / Tokyo `ap-northeast-1`                                                                                     |
| 状態                | `ACTIVE_HEALTHY`、PostgreSQL 17.11、release `17.11.0.003`                                                                       |
| DBホスト            | `db.ukdzggjfkcwjssjmnqim.supabase.co`                                                                                           |
| API URL             | `https://ukdzggjfkcwjssjmnqim.supabase.co`                                                                                      |
| 接続                | 管理API経由のPostgres SELECT成功、`pg_is_in_recovery()=false`。端末からのDBパスワード/TLS接続・アプリからのData APIは今回未検証 |
| アプリmigration     | MCP一覧0件。`supabase_migrations.schema_migrations`自体が未作成（`to_regclass`はNULL）                                          |
| アプリ領域          | publicテーブル0、public関数0、trial_private schemaなし                                                                          |
| Supabase管理領域    | auth 27テーブル、storage 8テーブル、realtime 3テーブル。これらはアプリmigration履歴とは別                                       |
| データ              | auth.users=0、auth.sessions=0、storage.buckets=0、storage.objects=0                                                             |
| セキュリティAdvisor | 現在の空DBに対する指摘0件。将来のmigration安全性の保証ではない                                                                  |
| 外部DB接続          | foreign server=0、論理replication subscription=0、replication slotなし、dblink/postgres_fdw未導入                               |
| 拡張                | pgcrypto等の標準拡張あり。pg_cron/pg_net未導入。Cron有効化なし                                                                  |

既存 `partner-mind` / `rnvrdrfdbapfafwjbygo` とはref・DBホスト・API URL・Auth領域が異なり、新DBにはユーザー/業務データのコピーがない。DB間の接続構成も検出しなかった。一方、同じ組織の管理者権限・課金・共有クォータまで分離された構成ではない。「完全分離」はこの境界を含めて説明する。秘密鍵の値を取得・比較・記録していない。

## 2. 初期Postgresエラー

対象期間：2026-10-15 06:15:04〜07:29:17 UTC（15:15:04〜16:29:17 JST）。取得したPostgresログ54件の内訳を分類した。

| 分類                                                | 件数・時刻                                 | 評価                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 42P01 / `realtime.subscription`なし                 | 37件、postgres_exporter、最後07:10:29 UTC  | 初期化中の監視で参照。現在はテーブル存在を確認。アプリSQLでRealtime管理テーブルを作らない                              |
| 42P01 / `realtime.schema_migrations`なし            | 2件、realtime_migrations、最後07:11:26 UTC | 現在は存在。初期化に伴う一時エラーと整合するが、内部原因の断定はしない                                                 |
| 42P01 / `supabase_migrations.schema_migrations`なし | 2件、mgmt-api、07:12:33/07:27:53 UTC       | 未適用DBの履歴照会に対応。今回のMCP list_migrationsも空配列を返す一方でこのエラーを残した。アプリmigration失敗ではない |
| FATAL 57P01                                         | 5件、06:17:32 UTCに集中                    | メッセージはadministrator commandによる接続終了。作成初期の再起動と整合。今回の調査で再起動はしていない                |
| LOG 08006                                           | 1件、06:17:38 UTC                          | Connection reset by peer。現時点のSELECTは成功                                                                         |
| その他LOG 00000                                     | 7件                                        | checkpoint等                                                                                                           |

この期間で07:12以降にあるERRORは履歴テーブル未作成の2件だけ。現在のRealtimeテーブルの存在を確認したため、過去エラーを理由に管理schemaを修復しない。適用直前に稼働状態と直近ログを再確認し、継続的なERROR/FATALや接続失敗があれば停止する。今後も一切エラーが出ないと保証する結果ではない。

## 3. 適用を保留する理由：Auth参照権限

実DBのカタログで以下を確認した。

| service_roleの権限                   | 結果  |
| ------------------------------------ | ----- |
| auth schema USAGE                    | true  |
| auth.users SELECT                    | false |
| auth.users.id SELECT                 | false |
| auth.users.email_confirmed_at SELECT | false |

15番・16番の`public.trial_claim`はSECURITY INVOKERであり、transaction内から`auth.users`のidとemail_confirmed_atを読む。上記ACLのままでは権限エラーとなり、会員への引き継ぎを完了できない。RLS bypassとテーブルSELECT権限は別である。

従来の`scripts/phase6/docker-verify.py`および`integration.mjs`のbootstrapは **`grant select on auth.users to service_role`を人工的に追加**している。これがDocker/HTTPの合格と実環境の差異を隠していた。484件・HTTP16件という既報の結果は撤回せず、その適用範囲を限定する。今回テストを再実行して成功扱いにはしていない。

4番migrationは旧診断引き継ぎのAuth参照を取り除き、`service_role must not receive access to auth.users`と明記している。安易にauth.users全体へSELECTを付与したり、trial_claim全体を広いSECURITY DEFINERに変えたりしない。

修正案は次の工程で設計・承認する。DB内の認証確認を維持する場合は、非公開schemaにbooleanだけ返す限定Auth確認関数を設け、読取対象をid/email_confirmed_atに限定した専用所有者・固定search_path・限定EXECUTE権限を検討する。認証済み本人との結び付け、JWT/sessionの検証、他人のID・未認証・失効・同時引き継ぎを含めてレビューする。権限が必要な理由と信頼境界を設計してから実装し、単にpermission deniedを消すための昇格をしない。

既存16ファイルは不変のまま。追加migrationが必要ならCLIで新規作成し、チェックサムとmanifestの件数を更新して改めて承認対象にする。まず実DBと同じ「service_roleにauth.users読取なし」のローカル環境で修正前失敗・修正後成功を再現し、ユーザー間所有権と権限拡大がないことを検証する。

## 4. SQL16件の照合と依存順序

16/16のSHA256が[manifest](phase6-external-migration-manifest.md)と一致。ファイル名のtimestamp昇順も一致。内容変更・追加・実適用なし。

| 順  | migrationの短縮名            | 前提・主な変更                                                                                              |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | partner_mind                 | 標準auth.users/auth.uidとUUID生成。基本19テーブル、RLS、RPC、診断質問seed                                   |
| 2   | foreign_key_indexes          | 1のFK対象へ索引                                                                                             |
| 3   | account_contact              | 1のprofiles/diagnoses/payments、contact_messages・引き継ぎRPC                                               |
| 4   | claim_service_role           | 3のRPCを置換。Auth確認はサーバー側へ                                                                        |
| 5   | editorial_cache              | 1のai_callsへ列/索引                                                                                        |
| 6   | contact_mail                 | 3のcontact_messages、送信キューテーブル/RPC。メールは送信しない                                             |
| 7   | editorial_retry              | 5のai_callsへ再利用可否列                                                                                   |
| 8   | contact_operations           | 3/6の問い合わせ運用列                                                                                       |
| 9   | dynamic_question_flow        | 1の診断・質問・有料report。選択質問/回答RPC・質問seed                                                       |
| 10  | continuing_consultation      | 1のpayments等、価格・契約・相手・相談の10テーブル、利用枠/RPC                                               |
| 11  | growth_measurement           | 1/10の計測列・集計・契約RPC                                                                                 |
| 12  | consultation_hardening       | 11の集計を置換、10の削除処理                                                                                |
| 13  | stripe_environment_isolation | 1/10/11/12の決済列・価格・RPCを環境分離。部分適用/再適用を明示拒否                                          |
| 14  | subscription_ended_at        | 10/13の契約とRPCに終了時刻・制約を追加                                                                      |
| 15  | trial_foundation             | 10のconsultation_threads複合FK、13のpayment_environment、Auth参照。7 privateテーブル＋1 publicテーブル・RPC |
| 16  | trial_safety_hardening       | 15のRPCを置換・追加。清掃heartbeat・予算・所有権・冪等性を強化                                              |

16件にpg_net/HTTP呼出し、Cron登録、Stripe/OpenAIへの通信処理はない。SQL内のseedは診断質問・設定・価格情報であり、実ユーザーや購入データをコピーしない。pg_cron有効化は16件とは別。

## 5. Stripe誤接続防止の確定方針

13番は`payment_environment`に既存Sandbox `acct_1UNSvsIYwtQeIHKP`をseedする。新DBへのSQL適用だけでStripe接続は発生しないが、旧秘密鍵と組み合わせると既存Sandboxに向かうため、鍵を流用しない。

正確なカタログ初期値：10番はSandbox report/Plusの2件をprice ID=NULL・active=falseで作る。13番は商品識別子を加え、Live価格2件をactive=falseで追加する。既存Sandboxの有効価格IDがSQLに埋め込まれているという以前の説明は訂正する。

1. 新DBをアプリへ接続せず、Stripe秘密鍵・Webhook secret・顧客/価格/Portal設定を投入しない。既存WebhookやPreviewは変更しない。`STRIPE_LIVE_CHECKOUT_ENABLED=false`はSandbox全体の停止スイッチではないため、それだけを防護としない。
2. 別承認で新独立Stripe Sandboxを作成し、そのaccount IDとtest専用キーを取得する。新IDが未確定なら空DBを維持し、Auth/診断/購入fixtureを入れない。
3. 新DB所有者の初期化transactionで対象ref・全業務データ0件を確認し、関係テーブルをロック。mode=sandboxを保ったままaccount IDを新IDへ更新する。既存IDを許可する迂回やtrigger無効化はしない。
4. 旧価格は非activeを維持し、新Sandboxの商品・価格は新version IDで追加する。既存価格の識別子・金額のUPDATEはguard_price_environmentが拒否する。Live seedも非activeを維持する。新価格・Portal・旧1,980円専用環境変数は新Sandboxだけに揃える。
5. アプリ接続前に、Supabase ref、新Stripe account ID、keyのtest形式、実際のaccount照合、商品/価格のlivemode=falseを確認する。現在のアプリはDB/account一致を検証するが、誤ったキーでaccount照会する可能性自体はあるため、旧キーを持ち込まない運用を第一の防護にする。

独立Sandbox未作成の間に既存Stripe設定へ接続して動作確認することはしない。

## 6. 適用後の検査方法（今回未実行）

16件そのままならpublic 35 + trial_private 7 = 42テーブル、public関数34（trigger関数3、trial RPC11を含む）を期待する。追加修正migrationが採用された場合は期待値を更新する。

- 履歴：timestamp16件がmanifestの順序・名前に一致。DDLと履歴がずれていないこと。全部を1回の無記名SQLとして流さない。
- RLS：42テーブルの有効化、pg_policiesの対象role・所有者条件・WITH CHECKを照合。Advisorを再実施する。
- 権限：anonは有効診断種別/質問のSELECTだけ、authenticatedは指定した所有者SELECTだけ。書込・TRUNCATE・DDL権限を拒否。service_roleは必要なテーブル操作とRPCのみ、payment_environment/legacy例外テーブルはSELECTのみ。trial_privateはブラウザーroleにschema USAGEも与えない。
- RPC：trial11件を含む公開関数にanon/authenticatedのEXECUTEがないこと。trigger関数を除く必要RPCのservice_role EXECUTEを確認。関数全体のSECURITY DEFINER化をしていないこと。
- 自動公開OFF：新DBのpostgres所有オブジェクトのデフォルトACLはservice_roleにもCRUD/EXECUTEを与えない。16件のアプリ用テーブル/RPCは明示grantがあることを静的確認したが、実適用後にも実効権限を確認する。既存Dockerの広いdefault grantを前提にしない。
- Auth：新projectのSite URL/redirect allowlistだけを使用。メール確認必須、匿名Supabase Auth sign-inは無効を確認。JWT/session更新・失効と認証確認を別承認の管理下アカウントで試験する。DDL適用はAuth Dashboard設定の変更を意味しない。今回は設定値の変更・実メール試験なし。
- OFF維持：trial_private.settings.enabled=false、価格期限2026-10-22 00:00 JST、清掃未設定、ユーザー・匿名相談・費用台帳・購入データ0件。trial_availability等の副作用があり得るRPCを単なる読取検査として呼ばない。
- 所有権：後日承認された合成A/Bアカウントだけで、別ユーザー閲覧拒否、同時引き継ぎ、重複/期限切れ/削除、CSRF、失効を検証する。空DBでRLS設定が存在することだけで所有権検証済みとは扱わない。

## 7. 実行方式・停止・復旧

現時点では実行許可なし。修正内容が確定した後、承認する対象をこの新refに固定する。元16 SQLの内容はmanifestで提示済み。Auth対策・Stripe初期化・Cron・fixtureは別SQL/別承認とし、既存16件へ無断で混ぜない。

実行担当は1名、専用の未リンク作業領域を用意し、新refと接続先を明示する。CLIのhelp・接続・dry-runの方法を実行前に確認する。既存projectにリンクされた作業領域や自動CIのDBデプロイを使わない。端末からの直接接続と実行器のtransaction/history処理は今回未検証なので、実行開始前の確認条件とする。

1〜12には明示BEGIN/COMMITがないため、SQL本文を行単位で手動送信せず、migration実行器でファイル単位の失敗停止を確認する。13〜16にはBEGIN/COMMITがある。全16件を外側の1transactionで包めば全部rollbackできるとは考えない。失敗済みファイルのpartial commitや履歴登録だけの失敗も検査する。13/14のlock timeout=5秒・statement timeout=60秒は無断で緩和しない。

適用直前の新DBだけを手動exportし、schema/default ACL/管理設定/アプリ履歴を記録。鍵やパスワードをGit・チャット・報告書へ出さず、暗号化・アクセス制限付きの端末保存を計画する。Freeの自動backup/PITRを保証にしない。[公式バックアップ説明](https://supabase.com/docs/guides/platform/backups)

今回はバックアップの採取・復元試験は未実施。前回Docker復元試験は合成DBについてのみであり、新クラウドDBのbackup復旧を検証した結果ではない。適用承認後も本実行前に新DBのexport取得・ローカル復元確認を完了する。Storage本体・Auth URL設定・API鍵などはDB dumpだけで完全復元されない。

失敗時は即停止、残りを適用せず、到達version・失敗statement・実際のschema状態を記録する。migration repairで成功扱いにしない。既存DBを復旧元/先にしない。新DBのreset・drop・project再作成も自動実行しない。既にcommit済みの変更をどう戻すか提示し、破壊的復旧は別承認で新DBだけに実施する。

## 8. 次に必要な承認

1. 最優先：Auth参照境界とDocker/HTTP試験の権限差異を修正・再検証する工程。対象は専用開発ブランチ/ローカル隔離DBで、クラウドには適用しない。
2. 修正後に、最終SQL一覧・新checksum・件数・バックアップ/復旧手順を再提示し、新refへのSQL適用を承認する。現状の16件だけの実行は推奨しない。
3. 独立Stripe Sandbox作成と空DB環境初期化は別承認。それまでAuthユーザー/購入データを投入しない。
4. メール宛先2件・最大4通、AI生成予算、Stripe取引、Vercel構築、Cronは後続の個別承認。今回は全て未実施。

変更は調査文書だけ。アプリ/16 migrationのコード変更・commit/push・CI再実行はしていない。外部33テストも全件未実行・未検証のまま。
