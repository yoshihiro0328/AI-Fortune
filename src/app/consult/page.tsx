import Consultation from "@/components/consultation";
export const metadata = {
  title: "前回の続きから相談する",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <Consultation
      screenshotPrototype={
        process.env.NODE_ENV === "development" &&
        process.env.LOCAL_REVIEW_ISOLATED === "true"
      }
      eventsEnabled={process.env.CONSULTATION_EVENTS_ENABLED === "true"}
    />
  );
}
