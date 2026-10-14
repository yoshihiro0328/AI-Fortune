# Phase 6 第1開発単位：15チケットの照合と対象範囲

2026-10-15 JST。Phase 5 の `phase6-planning/tickets/P6-01.md`～`P6-15.md`、experience-spec、9画面一覧、プロトタイプのApp.jsx・ChatExperience.jsx・topics.js・styles.cssを参照。既存設計を再調査・再制作せず、新TOPと匿名相談を実装する。

共通の検証：lint、型検査、Vitest、build、Docker PostgreSQL 17.11。実サービスの書き込み・デプロイ・ユーザー試験は別承認。チケット全体の完了と、第1単位内の実装完了を区別する。

| ID | 第1単位の対象・状態 | 主な変更ファイル | API / DB | 依存 | 既存への影響・テスト・完了条件 |
|---|---|---|---|---|---|
| P6-01 | 対象：安定版・運用境界照合 | 本書、operations.md | 既存DBの件数と非本文照合、変更なし | なし | HEAD一致、元コピーclean、14件履歴、Preview一致を確認。バックアップ原本保護 |
| P6-02 | 対象：短期セッション・台帳 | trial_foundation.sql、trial/security.ts | trial_private 7表、本文暗号化、24h | 01 | 90日診断Cookieと分離。期限・削除・権限のSQL試験成功 |
| P6-03 | 対象：発行・不正対策 | trial/server.ts、api/trial/session、api/auth | Turnstile確認、Cookie、IP制限、登録3試行/24h/IP | 01,02 | 既存ログインや月3/30枠は不変。CSRF・challenge不正・Cookie変更試験。実Turnstileは未検証 |
| P6-04 | 対象：予算予約・停止 | trial_foundation.sql、ai-engine/structured.ts | reserve/finish RPC、日$3・30日$90 | 01,02 | 行ロック・費用不明保持・単価期限・原子的停止。Docker並列で上限不超過 |
| P6-05 | 対象：短文AIの処理 | trial/prompt.ts、ai-engine/structured.ts | /api/trial/turns | 02,03,04,08 | 既存AI処理を変更せず新機能のみ共通化。生成は模擬応答で検証、実AI品質は未検証・機能OFF |
| P6-06 | 対象：匿名相談画面 | phase6/trial-chat.tsx、app/chat、phase6.css | session/turns/content/claim接続 | 03,05,08 | 同意、制限、失敗、停止表示。390px、320px、PCで確認。ブラウザーには本文を永続保存しない |
| P6-07 | 対象：明示的引き継ぎ | trial/server.ts、trial_claim、account/page.tsx | /api/trial/claim | 02,03,06,10の部分 | 表示アカウントと再認証結果照合、メール認証・Cookie所有権・一回限り移行。既存診断claimは不変 |
| P6-08 | 対象：4テーマと自由相談 | trial/topics.ts、trial/prompt.ts | version=1、fields許可リスト | 01 | 説明・入力例・項目・AI方針切替。未提示事実の創作禁止。既存会員チャットの全面テーマ化は次工程 |
| P6-09 | 一部：新チャットの表示領域・失敗時入力保持 | phase6/trial-chat.tsx、phase6.css | 追加なし | 06,08,10 | visualViewport、IME中送信抑止、コピー。会員の履歴検索・複数下書き・長文UI刷新は次工程 |
| P6-10 | 一部：移行ごとに独立した「あとで整理」相手 | trial_claim、trial_thread_context | 既存subject/thread/turnへ追加だけ | 01 | 他相手の記憶を混ぜない。履歴検索・出来事CRUD・相手kind追加は次工程 |
| P6-11 | 一部：TOPの料金目的表記 | phase6/home.tsx | 既存/plansへ遷移 | 01 | 単発980円と月額980円を区別。購入・解約・マイページ全面刷新は次工程 |
| P6-12 | 一部：新TOP/新相談のみ | shell.tsx、phase6.css | なし | 06,09,11,13 | 主要操作44px、15〜16px本文、コントラスト。残り7画面刷新、実機IME・読み上げは次工程 |
| P6-13 | 一部：新TOP→既存無料診断と相談履歴 | home.tsx | 既存URLを維持 | 08,10 | 既存診断・結果・有料レポートの全面改修は行わず、回帰テストで保護 |
| P6-14 | 対象：削除処理・停止条件と運用設計 | api/cron/trial、operations.md | cleanup RPC、10分以内の削除実行履歴を要求 | 02–07 | 保持期限・復元試験済。実Cron、バックアップ/鍵の期限管理、外部ログ保持の実設定は承認待ち。P1リリースゲート未完了 |
| P6-15 | 一部：今回範囲の自動・隔離DB・画面検証 | tests/trial*.ts、scripts/phase6/docker-verify.py | 合成DB/模擬AI | 対象機能すべて | 自動試験成功。実利用者5名、実外部E2E、公開承認は未実施。次単位へ自動進行しない |

## 9画面との対応

TOP・すぐ相談を今回実装。無料診断・結果・詳細レポート・継続相談・相手別ホーム・料金・マイページは既存実装を継続利用する。採用済み9画面すべてを刷新したという意味ではない。既存の相手別ホームへの入口は現在の `/consult` に接続する。
