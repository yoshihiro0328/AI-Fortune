import Link from "next/link";
export default function SaveResultNote() {
  return (
    <aside className="notice save-note" aria-label="結果の保存について">
      <p>後から読むには、診断をアカウントに保存してください（登録は任意）。</p>
      <p className="fine">
        アカウントに保存する前にブラウザの保存情報（Cookie）を削除したり、別のブラウザや端末へ移ったりすると、購入したレポートも開けなくなることがあります。URLの保存だけでは復元できません。
      </p>
      <Link href="/account">登録・ログインして保存する</Link>
    </aside>
  );
}
