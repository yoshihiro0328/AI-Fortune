import TrialChat from "@/components/phase6/trial-chat";
import { topicIds, type TopicId } from "@/lib/trial/topics";
export const metadata = {
  title: "登録なしですぐ相談",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const id = topicIds.includes(topic as TopicId)
    ? (topic as TopicId)
    : "general";
  return (
    <TrialChat
      initialTopic={id}
      siteKey={process.env.NEXT_PUBLIC_TRIAL_TURNSTILE_SITE_KEY ?? null}
    />
  );
}
