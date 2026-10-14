import Contact from "@/components/contact";
import { operator } from "@/lib/operator";
export const metadata = {
  title: "お問い合わせ",
  robots: {
    index: process.env.PUBLIC_INDEXING_ENABLED === "true",
    follow: process.env.PUBLIC_INDEXING_ENABLED === "true",
  },
  alternates: { canonical: "/contact" },
};
export default function Page() {
  return <Contact responseTime={operator.responseTime} />;
}
