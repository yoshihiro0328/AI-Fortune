import Link from "next/link";
export const metadata = {
  title: "危険やつらさを感じるとき",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <main id="main" className="legal">
      <h1>まず、あなたの安全を大切にしてください。</h1>
      <p>
        暴力や脅し、望まない性的なことを強いられている、自分を傷つけそうで怖い。そのようなときは、関係をよくする方法より、安全を確保することが先です。
      </p>
      <section>
        <h2>今すぐ危険があるとき</h2>
        <p>
          相手から距離を取り、人のいる安全な場所へ移動できるか考えてください。日本で緊急の危険がある場合は110、救急が必要な場合は119へ。日本以外では、その地域の緊急窓口に連絡してください。
        </p>
      </section>
      <section>
        <h2>ひとりで抱えなくて大丈夫です</h2>
        <p>
          信頼できる人に今の状況を伝え、安全な場所で一緒にいてもらうこともできます。自分を傷つけそうなときは、危険な物から離れ、身近な人や緊急窓口に助けを求めてください。
        </p>
        <p>
          端末を相手に見られる心配がある場合は、安全に使える端末から相談してください。無理に相手と直接話し合う必要はありません。
        </p>
      </section>
      <p>
        この案内に登録・契約は不要です。相談回数も使いません。よりそいは緊急対応の窓口ではなく、AIの判断には限界があります。
      </p>
      <p className="fine">
        窓口の情報：<a href="https://www.npa.go.jp/goiken_index.html">警察庁</a>
        ・
        <a href="https://www.fdma.go.jp/mission/enrichment/kyukyumusen_kinkyutuhou/119.html">
          消防庁
        </a>
      </p>
      <Link href="/consult">相談画面へ戻る</Link>
    </main>
  );
}
