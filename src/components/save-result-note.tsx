import Link from "next/link";
export default function SaveResultNote() {
  return (
    <aside className="notice" aria-label="結果の保存について">
      <p>
        結果を後から確認したい場合は、アカウントへの保存をおすすめします。登録は任意です。
      </p>
      <p className="fine">
        保存する前にCookieを削除したり、別のブラウザや端末へ移ったりすると、購入したレポートも開けなくなることがあります。URLの保存だけでは復元できません。
      </p>
      <Link href="/account">登録・ログインして診断を保存する</Link>
    </aside>
  );
}
