import TrialChat from "@/components/phase6/trial-chat";
import { topicIds, type TopicId } from "@/lib/trial/topics";
export const metadata = {
  title: "チャットで相談",
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
      screenshotPrototype={
        process.env.NODE_ENV === "development" &&
        process.env.LOCAL_REVIEW_ISOLATED === "true"
      }
      siteKey={process.env.NEXT_PUBLIC_TRIAL_TURNSTILE_SITE_KEY ?? null}
    />
  );
}
