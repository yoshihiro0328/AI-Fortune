import Link from "next/link";
import Account from "@/components/account";
export const metadata = {
  title: "マイページ",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ trial?: string }>;
}) {
  const trial = (await searchParams).trial === "1";
  return (
    <>
      {trial && (
        <div className="wrap">
          <p>
            登録・ログインとメール認証が済んだら、すぐ相談の画面へ戻り、ご自身の操作で履歴へ保存してください。
          </p>
          <Link className="button secondary" href="/chat">
            お試しの相談へ戻る
          </Link>
        </div>
      )}
      <Account testEmailOnly={process.env.AUTH_EMAIL_MODE !== "custom"} />
    </>
  );
}
