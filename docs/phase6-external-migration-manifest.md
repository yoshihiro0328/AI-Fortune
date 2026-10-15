# 独立Sandboxへの移行manifest（承認前）

既存16件の基準：`2b6eca7743e851b93115e836592c1a332cbeccb7`。2026-10-15、17番を追加。1〜16の内容・SHA256は不変。

全17件を新規の空のSupabase projectにだけ順番に適用する計画。まだ実行していない。適用候補は `yorisoi-integration-test` / `ukdzggjfkcwjssjmnqim`。既存ref `rnvrdrfdbapfafwjbygo` は適用禁止。この文書は承認や実行スクリプトではない。[事前確認](phase6-new-db-preflight.md)のAuth権限不整合を17番で修正。[ローカル再検証](phase6-auth-permissions-verification.md)を参照。実DB適用には別途明示承認が必要。

| 順  | ファイル（supabase/migrations）                   | SHA256                                                             |
| --- | ------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `20261006074109_partner_mind.sql`                 | `9d6cee0f36388668ac9fc4900f6dfbb9d0d78c0349a40adf74fccfd86729efc1` |
| 2   | `20261006080553_foreign_key_indexes.sql`          | `9b1e30734c380c6b7a9f63ab5299db3dcd751ef0f9ee02ff107f73da8306fc44` |
| 3   | `20261006114912_account_contact.sql`              | `338379be73a706df64c197e9f87375db794147b8360fd2a50e43017e7f99eff4` |
| 4   | `20261006115729_claim_service_role.sql`           | `673378a99ac85c5655a1cb1facfd73e10368b90a16a59a5fb1acfa0deb65ea14` |
| 5   | `20261007010000_editorial_cache.sql`              | `56023d1ef8dd3daa9cc60758435e98ca9682f1d3b3a82f930f50a635437b5686` |
| 6   | `20261007011000_contact_mail.sql`                 | `fbe9421e89db0f4dde8a20221813f7722ab1c94056ac2e06305e94aa2aa93a22` |
| 7   | `20261007012000_editorial_retry.sql`              | `b6fd01e9c2575ad0d497422e97a6c4ab81ab4b0b732b80abe3cb65fcb2acdafe` |
| 8   | `20261007070000_contact_operations.sql`           | `0ca4b891074dd1fb288ebacff4981ed995aef7157e9c190fd3dbc426d4aa7485` |
| 9   | `20261008124041_dynamic_question_flow.sql`        | `a93b9c33ed59b1f2adbb52878d5880d5145064a4ab5b41157dee1489e6e8ed0b` |
| 10  | `20261008163422_continuing_consultation.sql`      | `baf69bc288923178846f170496fe877046bb17aec835a0949d6fb9d4ccfb90a3` |
| 11  | `20261008165734_growth_measurement.sql`           | `a4829452cd7ddb7adde03b21ee589827810c3729a829f3a1499d0776728d08cd` |
| 12  | `20261008171809_consultation_hardening.sql`       | `8a2baa0d8035be225f1c6f22de9148712f25f435a385ee78495aaa79ba7d5cee` |
| 13  | `20261013074636_stripe_environment_isolation.sql` | `995b8663e076ad3f114b3c3d153dd67c27c5e94d14a32369358553ffe3a538f4` |
| 14  | `20261014075838_subscription_ended_at.sql`        | `a5df68778019be93f01e6a994f8f507d8cfc42e16a7d8354339defce47faeeca` |
| 15  | `20261014151638_trial_foundation.sql`             | `a4fd2ba72e518cde9b9446b6a0ea28d6103a9594e08eb2b736bd2a64f035838f` |
| 16  | `20261014160317_trial_safety_hardening.sql`       | `2be311a6e018e97aa5fbf06037d83cb14ef74d900d4b73630b03d8e1bb6fc691` |
| 17 | `20261015081652_trial_auth_verification.sql` | `eba7f238cb6799524062e49e9c4c1fb756ab2eb84c11e69b2d6cbcf1499dea97` |

1〜14が既存migration、15・16が匿名相談、17がAuth権限修正。1〜16のファイル内容は変更していない。作成承認とSQL適用承認は別。新ref、名称、組織、空DB、上記checksum、migration履歴を照合し、不一致なら停止する。

13番は既存Stripe Sandbox account IDと商品識別子、非activeのLive価格IDを初期値に含む。10番が作るSandbox価格2件はprice ID未設定・非activeであり、16件だけの適用では有効な決済カタログにならない。新独立Sandboxのaccount ID確定後、Authユーザー・診断・購入を投入する**前**に、新DB限定で環境初期化と新価格version追加を別途承認して適用する。既存価格IDのUPDATEは保護triggerが禁止する。既存DBのIDやmodeは変更しない。Live価格seedは非activeを維持する。

15番はenabled=false、価格期限2026-10-22 00:00 JSTをseedする。SQL適用は匿名AI有効化の承認ではない。実行が価格期限以降なら、価格再確認と新DBでの更新承認が必要。

失敗時は続行・履歴repair・既存DBresetをしない。到達versionを記録し、接続を閉じた新テストDBだけの再構築・復元計画を提示する。合成fixture、Cron、Auth設定、鍵保管、費用台帳は別の承認対象。

## 17番の依存関係と実行境界

順序は表の1→17。3のAuth参照は4が、11のAuth参照は12が置き換える。13の決済環境・10の相談テーブルを15が参照し、16が15のclaimを強化し、17がそのAuth確認部分だけを置換する。17は`trial_private`、16の`trial_claim`、`auth.users(id,email_confirmed_at)`、信頼済み所有者`postgres`に依存する。

17はtransaction単位。実行者がpostgres、postgresがBYPASSRLSを持ちAuthの必要2列を参照できることを事前条件として検査し、不一致なら例外で停止する。service_roleへのAuth SELECTやAuth RLS変更は行わない。新規private関数の作成・所有者・ACL・claim置換を一つのtransactionに含める。重複適用時はCREATE FUNCTIONが失敗するため、履歴を確認せず再実行しない。

1〜17の適用・事後検査が終わるまでアプリ、Authユーザー、Cron、fixture、外部鍵を接続しない。特に15/16だけの状態はAuth不整合が残る。17完了後も匿名AIはOFF。既存SQLのtransaction境界を尊重し、途中失敗を無視して後続SQLへ進まない。実行前に空DBのバックアップと復旧方法を承認し、失敗時は新DBへのアクセスを止める。詳細は[再検証報告の適用・復旧手順](phase6-auth-permissions-verification.md#適用前条件と復旧)を参照。
