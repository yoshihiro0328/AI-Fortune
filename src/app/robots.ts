import type { MetadataRoute } from "next";
const appUrl = () =>
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://partner-mind-vdiordna-2059.vercel.app";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow:
        process.env.PUBLIC_INDEXING_ENABLED === "true"
          ? [
              "/api/",
              "/auth/",
              "/account",
              "/consult",
              "/admin/",
              "/result/",
              "/report/",
              "/diagnosis/",
            ]
          : "/",
    },
    sitemap: appUrl() + "/sitemap.xml",
  };
}
