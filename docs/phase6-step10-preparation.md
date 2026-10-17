# Phase 6 STEP 10：相談履歴の所有権・匿名診断引き継ぎ検証の準備

調査日：2026-10-17。基準コミット：`d06ab5f66bbc66c7db19052e1e93907eda4678cc`。
対象：`yorisoi-integration-test` / `ukdzggjfkcwjssjmnqim`。
作業ブランチ：`codex/yorisoi-phase6-redesign`。

**今回実施したのは新DBの読み取り、設計、ローカル隔離検証だけ。実DBへの合成データ投入・引き継ぎ・削除は未実施、未承認。** 本番アプリ、RLS、Auth権限、17件のmigration本文は変更していない。プロフィール分離の実績を相談履歴の分離実績に流用しない。

## 1. 新DBの事前調査

新プロジェクトはACTIVE_HEALTHY、Tokyo、接続ホストは`db.ukdzggjfkcwjssjmnqim.supabase.co`。読み取り時点でAuthユーザー2、確認済み2、profiles 2、migration 17。相談相手・スレッド・発言・診断・購入・契約・顧客は各0。価格の有効件数0、匿名AIはDB側でOFF。

既存DB `rnvrdrfdbapfafwjbygo` には接続していない。Stripe・OpenAI・Vercel・メール送信の操作も行っていない。A/BのユーザーUUIDは実行時に保護された保存先と新DBで照合し、メール・パスワード・JWTを報告書やGitへ記録しない。

## 2. 最小合成データ：6テーブル、合計12行

| テーブル | 行数 | 内容・関連 |
|---|---:|---|
| consultation_subjects | 2 | A/B各1人の架空の相談相手。既存ユーザーUUIDをownerに指定 |
| consultation_threads | 2 | 各相手に1スレッド。ownerとsubjectの複合FKを一致 |
| consultation_turns | 2 | 各スレッドに架空の質問・合成回答1組。ready、charged=false、AI呼出しなし |
| diagnoses | 2 | 最初はuser_id=NULL。別々の匿名セッションハッシュ、既存partner-mind診断タイプを参照 |
| diagnosis_answers | 2 | 各診断に架空の回答1行。question_idはNULL |
| free_reports | 2 | 各診断に合成表示例1行。model=synthetic-no-ai |

実在人物・実際の相談・個人メール・パスワード・JWTは含めない。run UUIDとテーブル別の12個のUUIDをmanifestへ記録し、本文等にも合成テストと分かる表示を入れる。匿名セッションA/Bの生値は別々に生成し、DBには既存のSESSION_SECRETによるHMACだけを保存する。生Cookie・秘密鍵はログに出さない。

既存profilesは維持する。diagnosis_typesは参照のみ。diagnosis_analyses、diagnosis_selected_questions、paid_reports、subject_diagnoses、AI呼出し行は不要で作成しない。合成の質問・回答操作では生成APIを呼ばない。

## 3. アプリ・DB両方の検証

### Dockerで追加した18シナリオ

| 番号 | 検証内容 |
|---|---|
| 01 | 12行の作成、対象ごと2行 |
| 02 | 本人JWTで相談3テーブルの本人行のみ取得、相手行は0件、全件取得でも本人行のみ |
| 03 | 未ログインanon・不正JWTでは6テーブルとも拒否 |
| 04 | 実GET /api/consultationsでA/B各自の一覧・スレッド本文取得 |
| 05 | 同APIでA→B、B→Aのスレッド取得は404 |
| 06 | 未ログイン・不正JWT・メール未確認ユーザーの相談APIは401 |
| 07 | 匿名診断APIでセッションA/Bが互いの診断を取得できない |
| 08 | anon/authenticatedからclaim RPCの直接呼出しを拒否。未引き継ぎ診断を会員JWTのRLSでも取得不可 |
| 09 | 未確認ユーザー・未ログイン・不正JWTのclaim拒否、ownerはNULLのまま |
| 10 | 不正OriginのCSRF拒否、偽造Cookieと本文中のuser/session指定では引き継げない |
| 11 | Aの同時claimの処理件数は1と0。本文でBを指定してもAの本人UUIDだけを使用 |
| 12 | BはセッションBだけ引き継ぐ。既存profilesが不変 |
| 13 | 同一／他ユーザーで再claimしても0件。本人JWTによる相談・診断owner変更も拒否、owner不変 |
| 14 | 引き継ぎ後の診断・回答・無料レポートを本人JWTのRLSで分離 |
| 15 | 診断APIは本人のみ取得可。他ユーザーや元の匿名Cookieでは取得不可 |
| 16 | 想定外の関連行・未知のFKがあるとcleanupを拒否し、12行を残してrollback |
| 17 | manifestの12行だけ削除し、Auth・profiles・料金・利用枠は不変 |
| 18 | STEP 10の間は匿名AI OFF、外部プロバイダー生成呼出し増加0 |

相談APIはservice_role経由でDBを読み、member/ownThreadの本人確認とowner絞込みで保護する。したがって本人JWTによる直接RLS検証とは別にAPIの本文取得を必須確認する。

実Next.js HTTP API、PostgREST、実Postgres/RLSを組み合わせる。Auth getUserは隔離環境の合成プロバイダー、JWTはローカル署名であり、**Hosted Supabase AuthのSTEP 10成功を意味しない**。未確認ユーザーはDocker内だけの合成人物。実DBの確認済みA/Bを未確認へ戻したり、実DBに第3ユーザーを作ったりしない。

既存HTTP16シナリオは別集計で維持。既存の匿名AIモック回帰ではDocker内のみ機能を有効化するが、新DBとSTEP 10の試験部分ではOFFを維持する。

### 承認後の実DB実施順序（今回は未実施）

1. ref・接続ホスト・TLS検証・2人のUUIDと確認済み状態・profiles・全対象件数・migration17・価格全無効・匿名AI OFFを再照合。決済関連行は0必須。不一致なら停止。
2. UUID manifest、12行のSQL差分、バックアップと復元確認、予定API書込みを提示して承認を取得。投入前の件数・ACL・RLS・制約・ユーザー/プロフィールを保全する。
3. STEP 9と別の専用ローカル作業コピーを使用。既存.env.localを読まず、127.0.0.1限定、秘密情報をGit外で保管。既存ブラウザーのA/Bセッションを意図せず失効させない。
4. 合成Cookieを置く前に正しいA/Bのログイン状態を確立する。既存login処理も自動claimを呼ぶため、意図しない匿名Cookieを持ったままログインを試さない。Cookieの入替えは専用テスト領域だけに限定する。
5. 新DBだけへ12行を1トランザクションで投入。UUID一覧・結果件数を保存。結果不明なら読み取り照合し、再投入しない。
6. 本人の実JWT＋anonキーでRLSを検証する。service_roleで読めたことをRLS成功と扱わない。別途アプリAPIでowner絞込みを検証する。
7. 既存/api/authのaction=claimでA/Bを引き継ぐ。CSRF・Cookie・getUser・メール確認・rate limitを維持。偽造Cookie、他人のID指定、再送、既存所有者変更を拒否することを確認する。
8. Auth・profiles・価格・利用枠・決済0件・匿名AI OFFを比較。未知の書込み・外部通信・エラーで即停止。承認された場合だけ後述のcleanupを行う。

通信許可は新refの必要なAuth getUser等、対象テーブルの読み取り、明示承認したclaim/consume_limit RPCだけに絞る。相談GETが読むpayment_environment、service_settings、購買・契約の0件照会等も個別allowlistにする。Stripe Account IDは新Sandboxの非秘密設定値を照合するだけでStripeへ通信しない。signup/recover/resend、相談生成POST、決済、trial API、任意RPC、別refを拒否する。

実行器は現段階では`step10-prepare.mjs --plan`だけを提供し、クラウド実行モードを持たない。fixture/cleanupコンパイラはDockerからのみ使用した。実DB用の接続・通信許可ゲートは、承認されたUUID・操作範囲に合わせて最終レビューする。現在のSTEP 9環境の遮断設定を勝手に解除しない。

## 4. claim_anonymous_diagnosesの監査と副作用

`public.claim_anonymous_diagnoses(p_user uuid,p_session text)`はpostgres所有、SECURITY INVOKER、search_pathは空。anon/authenticatedのEXECUTEは不可、service_roleだけが実行可能。今回権限は変更していない。

SQL内ではp_user非NULLを要求し、profilesをON CONFLICT DO NOTHINGで作成、user_id=NULLかつ匿名セッションハッシュ一致のdiagnosesをp_userに紐付け、診断の更新件数を返す。既存ownerを上書きしない。同じ本人の再送はエラーではなく0件で終了する。

**メール認証確認はこのRPC内ではなく、サーバーのclaimDiagnoses(user)のemail_confirmed_at検査が担う。** /api/authはgetUserで本人を検証し、p_userはその結果から、p_sessionはHTTP-only CookieのHMACから作る。本文の任意user_id・認証フラグを信用しない。RPCにAuth全体のSELECTを追加する必要はない。service_roleを漏らすとこの境界が破られるため、ブラウザーへ渡さない。

副作用は次のとおり。

- profilesが欠けていれば作成され得る。今回はA/B両方の存在を前提にし、前後不変を確認する。
- diagnosesのuser_idとupdated_atが更新される。
- **paymentsのuser_id=NULL行を、そのユーザーが所有する診断全体について補完する処理がある。** 新たに引き継いだ診断だけに限定されていない。このためSTEP 10はpayments等0件を必須条件とし、1件でもあれば実施しない。今回SQLの既存動作は変更しない。
- /api/authはconsume_limitによりrate_limitsをinsert/updateする。IPのauth枠（40/時）と匿名Cookieのclaim枠（5/時）を消費する。試験順序・拒否ケース専用Cookieを固定して枠を守り、上限を緩めない。既存の共有IPカウンターを削除・初期化しない。

未引き継ぎ診断には未来の会員UUIDは保存されない。**真正な匿名Cookieを所持する確認済みユーザーは引き継げる**ため、共有ブラウザー・Cookie流出時に「必ず当初の人物だけ」とは保証できない。今回の検証は別セッション、偽造Cookie、別JWT、引き継ぎ済みowner不変の境界を確認する。この仕様を変更して特定アカウントへの事前固定を要求する場合は別途設計・承認が必要。

これはPhase 6のtrial_claim／匿名AIお試し機能とは別。trialの24時間期限や予算台帳の保証を従来の匿名診断へ読み替えない。

## 5. UUID限定クリーンアップ

manifestの6テーブル各2行、計12UUIDだけを対象とする。Auth・profiles・rate_limitsは削除しない。ユーザー全体削除、日付だけでの削除、DB reset、TRUNCATEは禁止。

- manifestのproject、run UUID、2人のUUID、セッションハッシュ、12個の一意UUID、各テーブル2件を検証する。
- 6テーブルと全既知FK依存テーブルを一定順序でロックし、検査と削除の間の追加行を防ぐ。lock_timeoutは3秒。Authはロックしない。ロック不成立なら停止する。
- 既知15本のFK構造と照合し、未知FK・想定外の関連行があれば削除しない。相談AI行のSET NULLも含め、巻込みを避ける。
- consultation_threads→subjects、turns→threads、diagnosis_answers/free_reports/analyses/selected_questions→diagnoses、subject_diagnoses、trial_thread_contextのCASCADEを点検する。
- consultation_ai_calls→turnsはSET NULL。payments/paid_reports/ai_calls/affiliate_recommendations/affiliate_clicks→diagnosesも確認する。いずれも予定外の参照があれば停止する。
- 削除前に各対象2行、所有者、親子関係、diagnosesのrun識別子と匿名ハッシュを照合する。
- turns→threads→subjects、answers→free_reports→diagnosesの順でUUID指定DELETEを1トランザクションで実行する。
- 削除後は各対象0行、既存A/B・profiles・利用枠・価格・権限が不変と確認する。

API利用制限行はUUIDを持たず既存IP記録を共有し得るため、この削除SQLに含めない。件数・期限のみ記録し、通常の失効に任せる。これを含めてDBが完全に実行前と同一になったとは報告しない。

失敗時は自動cleanup・再試行しない。COMMIT不明ならUUIDごとの状態を読み取り、対象を確定して別途削除承認を求める。未知の関連行を勝手に削除して続行しない。

## 6. 外部33件の分類

[個別対応表](phase6-external-test-matrix.md)のIDを維持した。今回安全に実行可能0件、隔離または修正が必要5件、STEP 10対象外28件。全33件未実行・未検証。

28件は新Authユーザー作成・AI生成を伴う相談品質試験で、既存A/B・生成なしという今回の対象に合わない。残り5件は.env.local再読込、既存成果物ID再利用、全件更新、Stripe書込み等の問題を先に直す必要がある。今回の新しい18シナリオを33件の成功数へ加算しない。

## 7. 品質検証・変更範囲

- 自動テスト：既存645＋追加27＝**672成功**。外部33件は従来どおり未検証。
- lint・型チェック・Next.jsビルド：成功。途中で不要なTypeScript抑制コメントを検出し、削除して再検証した。
- Docker：既存HTTP16シナリオを維持。新STEP 10 HTTP/RLS18シナリオを別集計。
- 既存Stripe初期化SQLのネットワークなしDocker検証：29項目成功。17migrationのSHA256一致も確認。
- 既存ローカル入力画面の8テスト：成功。最初の実行はローカル待受け制限で起動できず失敗し、127.0.0.1限定の実行権限で再実行して成功した。
- [隔離検証結果](phase6-step10-isolated-results.json)には新18件と既存16件、Dockerの権限・回帰結果を別々に保存した。
- GitHub CIはこの変更のコミットに対して実行し、最終報告でrun IDと結果を提示する。

変更ファイル：`scripts/phase6/step10-fixtures.mjs`、`step10-isolated.mjs`、`step10-prepare.mjs`、既存`integration.mjs`、`tests/step10-preparation.test.ts`、本書、隔離検証結果、外部33件対応表。

通常CIのDocker試験に新シナリオを組み込んだ。隔離試験は継承された実サービスキー・外部テスト有効化フラグ・.envファイルを拒否する。アプリ本体、既存17migration、RLS、Auth、既存テストの成功条件は変更していない。

## 8. 未検証事項・次に必要な承認

Hostedの実JWTによる相談本文・匿名診断の所有権とclaimは未検証。現在2人とも確認済みのため、Hostedでの未確認アカウント拒否も未検証（Dockerでは成功）。相談のAI生成、決済、メール、匿名AIお試しは今回対象外。

次工程では、新refだけを対象とした12行の投入、A/Bの本人JWTによる読み取りとclaim（診断owner2行とrate_limitsの更新）、専用ローカル通信許可、実行前のバックアップを承認対象とする。cleanupは対象12UUIDと関連行0件を確認したうえで別途承認を求める。A/Bユーザー・プロフィールの削除承認は求めない。

追加のクラウド資源・有料生成・メール送信は不要。今回、実サービスのデータ変更や追加費用を発生させる操作はしていない。承認を得るまで実DBへ投入せず、第2開発単位へ進まない。
