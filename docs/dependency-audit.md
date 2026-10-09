# 依存パッケージ監査（2026-10-07）

`npm audit --json`：high 5 / その他0。
`npm audit --omit=dev --json`：全severity 0。

| 対象 | severity | 区分 | 経路 | 対応 |
| --- | --- | --- | --- | --- |
| braces 3.0.3 | high | 開発用・間接依存 | micromatch → braces | 互換修正版なし・保留 |
| micromatch | high | 開発用・間接依存 | fast-glob → micromatch | 上流braces待ち |
| fast-glob | high | 開発用・間接依存 | @next/eslint-plugin-next → fast-glob | 同上 |
| @next/eslint-plugin-next | high | 開発用・間接依存 | eslint-config-next → plugin | 同上 |
| eslint-config-next 16.3.8 | high | devDependency | 上記の利用元 | 同上 |

原因は1件のbraces advisory（GHSA-vfj7-8cjw-p6xm / CVE-2026-93687）。深く入れ子になったパターンによるスタック枯渇。5件は別々の本番障害ではなく依存経路への波及表示。ユーザーが送る診断回答をこの開発用glob処理へ渡す経路はない。本番依存の監査は0件だが、開発・CIで信頼できないパターンや変更を扱うリスクは残る。

npmの自動修正案はeslint-config-nextを14.2.35へ戻すmajor変更。アプリのNext.js 16.3.8と世代が違うため採用しない。bracesの公開latestは3.0.3で、advisory対象（<=3.0.3）のまま。安全な修正版のない状態でaudit fix --forceや架空のoverrideを使わない。今回は依存バージョンを変更せず、lint/typecheck/単体テスト/buildを再実施する。

根拠： https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

今回の公開前再監査でも production=0 / development high=5、braces latest=3.0.3を確認。修正版なしのためバージョン変更なし。本番コードにはbracesの直接利用・動的globへの回答転送はなく、開発/CI側のリスクを継続記録する。
