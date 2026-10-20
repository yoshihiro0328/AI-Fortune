# 外部接続33件の対応表（実行前・全件未検証）

基準：8869a23d、調査日2026-10-15。既存6ファイルのskip対象をソースから追跡した。**33件＝28件の継続相談品質テスト＋5件の単独テスト**。1テスト内で多数の外部呼出し・書込みが発生するため、33リクエストという意味ではない。以下の「実行可」は準備と承認後の分類であり、今回の実行許可・実行済みを意味しない。

## 接続先・書込みの定義

| 記号 | 実際の接続と書込み                                                                                                                                                                                                            | 副作用・後片付け                                                                                                                                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C    | `NEXT_PUBLIC_SUPABASE_URL`のAuth Adminで合成ユーザー1件作成（28件で共有）、RESTで`consultation_ai_calls` insert/update。`api.openai.com/v1/responses`へ`chatAnswer`を送信                                                     | 1件あたり通常1回＋文章修正最大1回、出力上限2400。28件で28〜56生成。通常の相談API/会話履歴/相手記憶には保存しない。afterAllはAuthユーザー削除するがAI台帳はuser_id=NULLで残る。`../../work/continuation-ai-rounds.json`へ合成文と回答を書出す                                         |
| F    | 新DBの`diagnosis_types`読取、`diagnoses`2件作成、`ai_calls` insert/update、OpenAI Responses（followup＋編集/レビュー）                                                                                                        | テスト内で2ラウンド。自動DB cleanupなし。`../../work/followup-editorial-live.json`書出し。編集は最大3pass、各rewrite/review、runAIの通信再試行あり                                                                                                                                   |
| D    | `../../work/dynamic-e2e/<DYNAMIC_DIAGNOSTIC>.json`のIDを使い`analyzeDiagnosis`を直接呼ぶ。新DBの診断/質問/回答/analysis/report/flow関連/analytics/operation_locksと`ai_calls`、OpenAI Responses                               | lock取得・解除、診断状態・質問flow・分析/無料reportのinsert/update、失敗状態更新。元のローカルJSONは旧DBのIDを指す可能性。consoleに結果/エラーを出す。実HTTP/メール試験ではない                                                                                                      |
| E    | 新DBに最大10件の`diagnoses`、`ai_calls`を作成/更新。分類→分析→無料/有料の下書き→followup＋各編集/レビューをOpenAI Responsesへ                                                                                                 | 各相談の編集は最大3pass、runAIの通信再試行あり。ケース2並列。`EDITORIAL_ROUND`既定1、コード自体は2ラウンドを自動実行しない（テスト名とは区別）。`../../work/editorial-live`の完了JSON/IDを再利用。DB cleanupなし。無料/有料report本表を保存する試験ではない                          |
| B    | 新DBの旧prompt_versionの`free_reports`/readyの`paid_reports`を**全行抽出**。`ai_calls`へ原文backup・生成記録、OpenAI編集、元report_json/prompt_versionをupdate                                                                | run ID絞込みなし、行数上限なし、元レポートを上書き。`../../work/editorial-backfill.json`出力。空対象は`every()`で成功になり得る。cleanup/ロールバックなし                                                                                                                            |
| S    | `api.stripe.com`の新SandboxにTest Clock、Customer、支払手段、Subscription×2、Portal sessionを作成/更新・解約。Auth Adminで合成ユーザー作成、新DBのbilling_customers/subscriptions/subscription_invoices/stripe_events等へ同期 | `TEST_BASE_URL`（既定127.0.0.1:3100）の`/api/webhooks/stripe`へ自作テスト署名でPOST/重複再送。Stripeの実配送とは別。既存固定PreviewのPortal return_urlをハードコード。clock/customer/user等のfinally cleanupなし。`../../work/subscription-lifecycle.json`出力。OpenAIは直接呼ばない |

C/F/D/E/Bは従来のAI処理で、匿名相談の`TRIAL_OPENAI_API_KEY`と日3ドル予約台帳を通らない。`OPENAI_API_KEY`の専用project課金として別計測する。モデルはCが`OPENAI_CHAT_MODEL`（既定gpt-6-luna）、F/D/E/Bが`OPENAI_MODEL`。既存.env.localを使わない。

## 33件の個別分類

「条件付可」は新ref/専用project/合成データ/上限/cleanupを準備し、明示承認後に実施できるもの。「改修後」は現状のまま実行してはいけないもの。全行の現在結果は未実行・未検証。

| ID  | テストファイル／ケース                                                                                       | 接続・書込 | 独立Sandboxでの分類                                                                                   | 現在結果 |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------- | -------- |
| 01  | `consultation-live.test.ts` / 1: 返信が遅い                                                                  | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 02  | `consultation-live.test.ts` / 1: 相手からLINE                                                                | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 03  | `consultation-live.test.ts` / 1: 会う頻度                                                                    | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 04  | `consultation-live.test.ts` / 1: 片思い                                                                      | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 05  | `consultation-live.test.ts` / 1: 交際中                                                                      | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 06  | `consultation-live.test.ts` / 1: 復縁                                                                        | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 07  | `consultation-live.test.ts` / 1: マッチングアプリ                                                            | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 08  | `consultation-live.test.ts` / 1: 曖昧な関係                                                                  | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 09  | `consultation-live.test.ts` / 1: ケンカ                                                                      | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 10  | `consultation-live.test.ts` / 1: 忙しい相手                                                                  | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 11  | `consultation-live.test.ts` / 1: 状況変化                                                                    | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 12  | `consultation-live.test.ts` / 1: 矛盾・訂正                                                                  | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 13  | `consultation-live.test.ts` / 1: 別の相手                                                                    | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 14  | `consultation-live.test.ts` / 1: 安全                                                                        | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 15  | `consultation-live.test.ts` / 2: 返信が遅い                                                                  | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 16  | `consultation-live.test.ts` / 2: 相手からLINE                                                                | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 17  | `consultation-live.test.ts` / 2: 会う頻度                                                                    | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 18  | `consultation-live.test.ts` / 2: 片思い                                                                      | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 19  | `consultation-live.test.ts` / 2: 交際中                                                                      | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 20  | `consultation-live.test.ts` / 2: 復縁                                                                        | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 21  | `consultation-live.test.ts` / 2: マッチングアプリ                                                            | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 22  | `consultation-live.test.ts` / 2: 曖昧な関係                                                                  | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 23  | `consultation-live.test.ts` / 2: ケンカ                                                                      | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 24  | `consultation-live.test.ts` / 2: 忙しい相手                                                                  | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 25  | `consultation-live.test.ts` / 2: 状況変化                                                                    | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 26  | `consultation-live.test.ts` / 2: 矛盾・訂正                                                                  | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 27  | `consultation-live.test.ts` / 2: 別の相手                                                                    | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 28  | `consultation-live.test.ts` / 2: 安全                                                                        | C          | 条件付可：新Auth＋新DB＋専用OpenAI、請求記録を残してrun限定cleanup                                    | 未検証   |
| 29  | `followup-editorial-live.test.ts` / rewrite real additional questions twice                                  | F          | 改修後：.env.local強制上書き撤去/新ref guard、出力先隔離、2診断cleanup                                | 未検証   |
| 30  | `dynamic-live.test.ts` / resume real dynamic pipeline                                                        | D          | 改修後：新DBで作った合成ID/flow JSONを指定、既存JSON拒否、ref guard、ログの本文非表示                 | 未検証   |
| 31  | `editorial-live.test.ts` / two rounds of real structured output and editorial review                         | E          | 改修後：新ref guard、既存完了JSON/ID再利用禁止、run別出力、対象ケース/round数/予算固定                | 未検証   |
| 32  | `editorial-backfill.test.ts` / backfill existing reports with original preserved and facts reviewed          | B          | 改修後：合成report ID allowlist＋期待行数、空件数で失敗、原文保存と復元、更新前差分確認               | 未検証   |
| 33  | `subscription-live.test.ts` / Sandbox subscription payment, replay, renewal, failure, cancel and resubscribe | S          | 改修後：新Sandbox account/ref/URL guard、固定return_url撤去、finally cleanup、保護付きWebhook経路承認 | 未検証   |

## 全件共通の実行前ゲート（まだ未実装・未実行）

1. 完全に別の作業ディレクトリ/出力ディレクトリを使い、旧`.env.local`と`../../work`成果物を持ち込まない。F/D/E/Bはコード内で.env.localを再読込してprocess.envを上書きするため、外から安全なenvを渡すだけでは不十分。明示した専用envのみに変更し、変更をレビューする。
2. 新Supabase ref、Stripe account ID、新OpenAI project ID、TEST_BASE_URLを承認済みallowlistと照合する実行guardを加える。既存ref/固定Preview/デモPreview/Liveキー、未指定対象は即終了。見た目の`is_test`だけに依存しない。
3. fixtureに一意のrun IDを付け、作成予定件数・実作成ID・更新対象ID・後片付けIDを記録する。Auth Adminの`email_confirm:true`はメール認証の成功として数えない。既存のメール宛先やデータを再利用しない。
4. dry-runで書込予定を列挙し、Bの全行更新はrun限定に変更する。Sのアカウント全体イベント一覧は対象Customer/Subscriptionに厳密に限定する。想定以外の行を発見したら中止する。
5. C/F/D/E/BのAI見積を件数だけで判断しない。入力token・出力上限・モデル・編集pass・通信再試行・キャッシュ再利用を計測。初回は1ケースずつ、請求反映を照合してから増やす。エラー時の未知usageも予算に残す。
6. Sでは専用Sandboxに既存環境のWebhookがないことを確認する。現在のAI Fortune テストには固定Previewへの有効なWebhookがあるため、そこで実行しない。価格/Portal/DBのaccount IDを全て新Sandboxにそろえる。
7. 後片付けは今回作成したfixtureだけ、失敗時も実行可能にする。Stripe test-clock/customer、Authユーザー、DB関連行、ローカル合成回答の保持/削除範囲を承認する。費用記録は匿名化して照合完了まで保持する。
8. 専用外部試験は通常CIと分離し、未承認のflagsはOFF。失敗をskipへ変更して成功扱いにしない。実行後も33行それぞれにpassed/failed/not-runを残す。

## この33件では確認できない項目

Supabase Auth確認メール/実login/refresh/revoke、匿名相談APIの実Turnstileと実OpenAIの組合せ、ブラウザーCookieの強制、Stripeから保護付きVercelへの実Webhook配送、24時間の実経過、クラウドCron/バックアップ復元は別シナリオが必要。[構築計画](phase6-external-sandbox-preparation.md)のAuth/運用試験と、既存ローカルHTTP16件を外部用に安全に置き換えた試験で補う。ローカルモックを外しただけで既存環境に向けない。

現在の484件・HTTP16件を維持するため、今回テストコードは変更していない。上記修正は、次工程で実行範囲・新ID・費用が確定してから専用ブランチで行う準備事項。全33件は引き続き未検証。

## STEP 10での再分類（2026-10-17）

上記は外部Sandbox全体を見た以前の分類。以下は**今回の既存A/B・合成データ・生成なしの所有権試験**に限定した再分類であり、28件の「条件付可」を今回の実行許可と解釈しない。

| 既存ID | 件数 | STEP 10での分類 | 理由・停止条件 |
|---|---:|---|---|
| 01–28（個別ケースは上表） | 28 | 今回のSTEP 10では対象外 | 新Authユーザー作成・削除、OpenAI生成を伴う相談品質試験。既存A/Bを使う所有権試験ではない。将来もref固定・予算・UUID cleanup・専用環境の承認が必要 |
| 29 | 1 | 隔離または修正が必要 | .env.localの強制読込を撤去。2診断と出力先を専用化し、生成は別承認 |
| 30 | 1 | 隔離または修正が必要 | .env.localと既存診断JSON/IDへの依存を除去。専用runの合成IDだけを許可 |
| 31 | 1 | 隔離または修正が必要 | .env.local・既存完了JSON再利用を禁止、生成件数と出力先を固定 |
| 32 | 1 | 隔離または修正が必要 | .env.localと既存report全件更新経路を禁止、UUID allowlistとrollbackが必要 |
| 33 | 1 | 隔離または修正が必要 | Stripeモードだけでなくaccount/ref/URLを固定。Auth・決済・Webhook操作、旧価格・固定Preview参照が今回の許可外 |
| 該当なし | 0 | 安全に実行可能 | 既存33件をそのまま今回実行してよいものはない |

分類は重複集計しない（0＋5＋28＝33）。5件も機能としては今回対象外だが、危険経路の改修必要性を優先して分類した。テストを緩めたり失敗をskipに変更していない。全33件は引き続き未実行・未検証。今回追加したローカルHTTP/RLS18シナリオとは別集計。

詳細は[STEP 10準備書](phase6-step10-preparation.md)。準備専用実行器は外部接続を持たず、実サービス資格情報・外部実行フラグを拒否する。既存外部33件自体の危険経路が全面改修済みという意味ではない。


## 購入と閲覧の完了後に残る33件（2026年10月20日）

この節は既存テストの内容を再確認した分類であり、実行承認ではない。6ファイル、33ケースはすべて未実行・未検証のまま維持する。通常CIでは元からの条件付きskipが33件表示される。今回完了した単発購入・合成本文の閲覧・本人JWTのRLS試験を、次の33件の成功へ読み替えない。

| ID | 件数と内容 | 実行前提と必要な改修 | 費用と外部変更 |
|---|---|---|---|
| 01–28 | `consultation-live.test.ts` の14相談ケース×2ラウンド。返信、誘い、関係変化、安全対応等の生成品質 | 専用Authユーザー・新DB・専用AI接続と予算が必要。接続先の固定、run別成果物、作成UUID限定の後片付けを追加。管理APIによる確認済みユーザー作成はメール認証試験とは別 | OpenAI従量費用あり。Auth作成・削除、利用量・AI呼び出し記録等のDB更新あり |
| 29 | `followup-editorial-live.test.ts` の追加質問生成と編集、2ラウンド | `.env.local`強制読込を廃止し、専用設定に限定。診断2件のrun識別、出力先隔離、保持・削除方法を決定 | OpenAI生成・編集の従量費用あり。診断・AI記録等の追加あり |
| 30 | `dynamic-live.test.ts` の動的診断パイプライン再開 | `.env.local`と既存workのJSON/ID依存を除去。今回用の合成診断ID、許容段階・件数、ログの秘匿を固定 | OpenAI従量費用あり。診断フロー・回答・生成記録等の更新あり |
| 31 | `editorial-live.test.ts` の分類・分析・無料/有料レポート・質問の生成と編集 | `.env.local`、既存完了JSONの再利用を廃止。ケース・ラウンドを明示（テスト名だけで2ラウンド実施としない）。専用IDとtoken予算を固定 | 複数段階のOpenAI従量費用あり。診断・AI記録等の追加とローカル成果物作成あり |
| 32 | `editorial-backfill.test.ts` の既存レポート編集・差し替え | 全件走査を許可しない。専用合成UUIDのallowlist、期待件数、更新前バックアップ・復旧範囲を追加。空集合を成功にしない。旧.env禁止 | OpenAI従量費用あり。無料/有料本文のUPDATE、原文保存用AI記録のINSERTあり |
| 33 | `subscription-live.test.ts` の月額Plus初回、重複通知、更新、失敗、解約、再契約、Portal | 新Account/ref/専用URLを固定。旧価格ID・固定Previewのreturn_url・アカウント全体イベント検索を撤去。Test Clock/Customer/契約の作成数、Webhook経路・終了処理の承認が必要 | Sandboxの模擬決済を想定し実請求は行わない。Auth、Stripe Customer/Subscription/Invoice/Test Clock/PortalとDBへの変更あり。実行直前にサービス利用条件・追加費用なしを確認 |

01–32の金額は未算定。モデル、入力/出力token上限、編集回数、再試行上限を確定してから見積・承認する。33件のうち今のコードをそのまま安全に実行可能としたものは0件。すべて接続先固定等の隔離・修正と別承認が必要であり、今回CIには外部実行の秘密情報を渡さない。

次工程の候補は月額PlusとPortalの**準備・ローカル隔離検証**。外部実行は別承認とし、単発購入を再実行しない。AI生成の費用承認はこれと分ける。
