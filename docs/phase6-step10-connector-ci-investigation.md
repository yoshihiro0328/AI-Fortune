# STEP 10 Supabase連携・CI起動失敗調査

2026-10-17。対象は `ukdzggjfkcwjssjmnqim` のみ。基準コミットは `4369d3836d74fa3b10e96d807894dbd797ff0ba1`。

## 読み取り確認

プロジェクト取得とSELECTは成功し、再認証は不要だった。状態はACTIVE_HEALTHY、ホストは `db.ukdzggjfkcwjssjmnqim.supabase.co` と完全一致。前回の削除要求で発生した `Invalid or expired requestState` について、読み取り成功は書き込み要求の復旧を保証しない。今回はDELETE・更新・再投入・認証セッション更新を一切実行していない。

| 確認項目 | 結果 |
|---|---|
| Authユーザー／認証済み／profiles／セッション | 2 / 2 / 2 / 3 |
| consultation_subjects / threads / turns | 各2 |
| diagnoses / diagnosis_answers / free_reports | 各2 |
| rate_limits | 26 |
| payments / subscriptions / billing_customers | 各0 |
| ai_calls / consultation_ai_calls | 各0 |
| migration / RLS有効アプリテーブル | 17 / 42 |
| 有効価格／匿名AI | 0 / OFF |

元manifestと前回記録に照らし、12UUIDの全フィールド・所有者・親子関係は一致した。保護対象47テーブルの件数と内容fingerprint、Authを含むACL/RLS・ポリシー・制約・関数・トリガーも前回記録と一致。12行は残存している。資格情報やUUID等を出力せず、今回取得した内容はGit管理外で暗号化保存した。

## CI 39015093875の確定事項と限界

失敗箇所は `step10-complete-sql-verify.py` の `docker run`。SQL適用前で、元スクリプトはstderrを捕捉したまま破棄していた。GitHubログにあるのは汎用RuntimeErrorのみで、取得制限・権限・イメージ不在などの根本原因を元ログから確定できない。

元runnerはUbuntu 24.04.5、イメージubuntu-24.04 / 20261012.334.1。使用コンテナーイメージは `public.ecr.aws/supabase/postgres:17.11.0.004`。ローカルはDocker 28.5.1 / linux arm64で同じタグが利用可能。ローカル成功だけをGitHub側amd64での取得成功と読み替えない。

## 修正

- 起動段階だけに固定語彙のエラー分類を追加。レート制限、manifest不在、platform不一致、daemon接続／権限、registry認証、ディスク不足、ネットワーク／TLS、名前競合、引数不正、未分類を区別する。分類はstderrのシグナルに基づくもので、raw stderrや実行引数は出力しない。
- Dockerバージョン・OS・CPUを許可された形式だけで出力する。SQL実行のstderrはこの診断経路に入れない。起動後readyにならない場合も、SQL投入前のログだけを分類する。
- 固定cleanupファイルを指定した場合は、そのファイルを直接読む。元manifestから一時ファイルを生成し直す処理も通さない。SHA256照合と実PostgreSQLによる29項目の検証を維持する。
- アプリ、既存17migration、RLS、SQL本文、Dockerイメージ・隔離条件は変更していない。テストを削除・skipへ変更していない。

追加16テストは分類、秘密値の非出力、環境情報の制限、固定SQL非再生成、SQLエラー分離を検証する。既存727件を維持し合計743件成功。外部33件は従来どおり未実施・未検証。

lint・型チェック・Next.jsビルド成功。固定INSERTとcleanupのDocker検証29項目、Stripe初期化隔離29項目成功。HTTP検証の最初のローカル実行はビルドと重なり、所有権シナリオ04で応答解析に失敗した。依存順序を誤った実行として記録し、ビルド完了後に再検証する。HTTP16・所有権18と修正コミットのGitHub CI最終結果は完了報告に記載する。新しいCIが成功しても、元runの失われたstderrを復元したとは扱わない。

## 固定SQLと前回記録

cleanup SHA256は不変：

`9b7bb4f5cd8864f1761f4be835bb824112d676b3592c66a83451a656440ea1a5`

元SQL、manifest、artifact、暗号化バックアップ2件、削除予約、エラー応答、STOP、失敗後暗号化記録の9ファイルをハッシュ照合して不変を確認。今回の調査記録は別ディレクトリへ保存した。前回予約の削除・再利用・成功扱いへの書換えはしていない。

## 次回削除の条件

クリーンアップは未完了。改めて明示承認を受けた後のみ、同一Ref・host、12UUID・全事前件数・所有者・FK・設定、バックアップ復号確認、固定SHA256を再確認する。前回失敗に紐づく新しい試行記録を作成し、1回だけ送信する。結果不明時は読み取り照合で停止する。今回の調査では新しい削除予約も作っていない。

既存Supabase、Stripe、OpenAI、メール、Vercel、mainには接続・変更していない。STEP 10以外に進まない。
