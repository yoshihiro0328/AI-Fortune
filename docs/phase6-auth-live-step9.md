# STEP 9 実メール認証検証（実行中）

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
