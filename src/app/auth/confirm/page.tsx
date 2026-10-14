import Confirm from "@/components/auth-confirm";
export const metadata = {
  title: "メール確認",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <Confirm />;
}
