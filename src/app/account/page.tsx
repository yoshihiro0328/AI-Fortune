import Account from "@/components/account";
export const metadata = {
  title: "マイページ",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <Account testEmailOnly={process.env.AUTH_EMAIL_MODE !== "custom"} />;
}
