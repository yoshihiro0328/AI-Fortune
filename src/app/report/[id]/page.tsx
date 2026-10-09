export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};
import Report from "@/components/paid-report";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Report id={(await params).id} />;
}
