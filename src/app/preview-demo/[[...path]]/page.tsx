import { notFound } from "next/navigation";
import { demoEnabled } from "@/lib/demo/config";
import DemoScreen from "@/components/demo/screen";
import Home from "@/components/phase6/home";
import Phase6Shell from "@/components/phase6/shell";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "合成データのデモ",
  robots: { index: false, follow: false, nocache: true },
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The isolated route cannot be opened in normal/production mode, even directly.
  if (!demoEnabled()) notFound();
  const { path = [] } = await params;
  const query = await searchParams;
  if (!path.length)
    return (
      <Phase6Shell demoHome>
        <Home trialEnabled={false} />
      </Phase6Shell>
    );
  return (
    <DemoScreen
      path={"/" + path.join("/")}
      topic={typeof query.topic === "string" ? query.topic : "general"}
      thread={typeof query.demoThread === "string" ? query.demoThread : ""}
    />
  );
}
