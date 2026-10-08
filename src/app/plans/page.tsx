import Plans from "@/components/plans";
import { serviceSettings } from "@/lib/service-settings";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "料金・プラン",
  description:
    "初回診断無料、継続相談は無料月3回。Plus月額980円、単発詳細診断980円。現在はテスト決済のみです。",
  alternates: { canonical: "/plans" },
  robots: { index: false, follow: false },
};
export default async function Page() {
  const s = await serviceSettings();
  return (
    <main id="main" className="wrap section">
      <p className="eyebrow">あなたのペースで選べます</p>
      <h1>必要なときに、必要な相談を。</h1>
      <p>
        無料でも、今の悩みを一緒に整理します。続けて相談したいときや、今回の状況を深く整理したいときにお選びください。
      </p>
      <Plans free={s.free_limit} plus={s.plus_limit} />
    </main>
  );
}
