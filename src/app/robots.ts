import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-origin";

// Private, session-gated sections (src/middleware.ts's auth redirect already
// blocks a crawler without a session) are disallowed here too so a crawler
// never spends budget walking into the login redirect. /read/:token carries
// its own secret share credential in the URL; keep it out of robots and
// search entirely, on top of its page's own noindex meta.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/account/delete"],
      disallow: ["/api/", "/project/", "/account/", "/email/preferences", "/read/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
