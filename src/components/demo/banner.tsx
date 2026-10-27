import Link from "next/link";
export default function DemoBanner() {
  return (
    <aside className="demo-banner" aria-label="デモ環境の案内">
      <strong>画面検証用デモ · 合成データのみ</strong>
      <p>
        実際のログイン・AI生成・決済は行いません。入力は送信・保存されず、画面更新でリセットされます。
      </p>
      <nav aria-label="デモの画面一覧">
        <Link href="/">TOP</Link>
        <Link href="/diagnosis/partner-mind">診断デモ</Link>
        <Link href="/result/demo-example">結果例</Link>
        <Link href="/report/demo-example">詳細レポート例</Link>
        <Link href="/plans">料金比較</Link>
        <Link href="/account">アカウント例</Link>
        <Link href="/consult">相談・履歴</Link>
      </nav>
    </aside>
  );
}
