import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-origin";
import { CHANGELOG_ENTRIES } from "@/lib/changelog-data.generated";

// Only the pages search engines should rank: the public marketing surface.
// `/about` is excluded (it's `/`'s content, under its own canonical tag) and
// `/launch` is excluded (a permanent redirect to `/`). Auth/utility pages
// (login, signup, password reset, ...) carry their own noindex meta instead.
export default function sitemap(): MetadataRoute.Sitemap {
  const latestChangelogDate = CHANGELOG_ENTRIES.find((entry) => entry.date)?.date;
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/features`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    {
      url: `${SITE_URL}/changelog`,
      ...(latestChangelogDate ? { lastModified: latestChangelogDate } : {}),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
