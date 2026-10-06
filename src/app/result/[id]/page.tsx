export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};
import Result from "@/components/result";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Result id={(await params).id} />;
}
