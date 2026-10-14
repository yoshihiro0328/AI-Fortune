import Link from "next/link";
import { notFound } from "next/navigation";
import { guides } from "@/lib/guides";
import ServiceShare from "@/components/service-share";
export function generateStaticParams() {
  return guides.map((g) => ({ slug: g.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const g = guides.find((g) => g.slug === slug);
  return {
    title: g?.title,
    description: g?.description,
    alternates: { canonical: "/guides/" + slug },
    openGraph: {
      title: g?.title,
      description: g?.description,
      type: "article",
      url: "/guides/" + slug,
      images: ["/opengraph-image"],
    },
    twitter: {
      card: "summary_large_image",
      title: g?.title,
      description: g?.description,
      images: ["/opengraph-image"],
    },
    robots: {
      index: process.env.PUBLIC_INDEXING_ENABLED === "true",
      follow: process.env.PUBLIC_INDEXING_ENABLED === "true",
    },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const g = guides.find((g) => g.slug === slug);
  if (!g) notFound();
  return (
    <main id="main" className="legal">
      <Link href="/guides">恋愛相談の読みもの</Link>
      <h1>{g.title}</h1>
      <p className="lead">{g.description}</p>
      {g.sections.map(([title, text]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{text}</p>
        </section>
      ))}
      <section className="panel">
        <h2>あなたの状況に合わせて考えてみる</h2>
        <p>
          一般的な例と、実際のふたりの状況は違うことがあります。最近のやり取りから、次にどうするかを一緒に整理できます。
        </p>
        <Link className="button" href="/diagnosis/partner-mind?source=guide">
          無料で相談してみる
        </Link>
        <p className="fine">
          初回診断無料・登録不要。既に相談している方は、
          <Link href="/consult">前回の続きから</Link>話せます。
        </p>
      </section>
      <h2>あわせて読む</h2>
      <ul>
        {guides
          .filter((x) => x.slug !== slug)
          .slice(0, 3)
          .map((x) => (
            <li key={x.slug}>
              <Link href={"/guides/" + x.slug}>{x.title}</Link>
            </li>
          ))}
      </ul>
      <ServiceShare />
    </main>
  );
}
