import type { MetadataRoute } from "next";
import { guides } from "@/lib/guides";
const appUrl = () =>
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://partner-mind-vdiordna-2059.vercel.app";
export default function sitemap(): MetadataRoute.Sitemap {
  return process.env.PUBLIC_INDEXING_ENABLED === "true"
    ? [
        "/",
        "/contact",
        "/plans",
        "/guides",
        ...guides.map((g) => "/guides/" + g.slug),
        ...[
          "terms",
          "privacy",
          "commerce",
          "refund",
          "ai",
          "disclaimer",
          "advertising",
        ].map((s) => "/legal/" + s),
      ].map((p) => ({ url: appUrl() + p }))
    : [];
}
