import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import BrandMark from "@/components/BrandMark";
import ThemeToggle from "@/components/ThemeToggle";
import BackLink from "@/app/privacy/BackLink";
import { CHANGELOG_ENTRIES } from "@/lib/changelog-data.generated";
import { formatChangelogDate } from "@/lib/changelog-parse";
import "../privacy/privacy.css";

export const metadata: Metadata = {
  title: "What's new - Ciciro",
  description: "New features and changes in Ciciro, newest first.",
  openGraph: {
    title: "What's new - Ciciro",
    description: "New features and changes in Ciciro, newest first.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "What's new - Ciciro",
    description: "New features and changes in Ciciro, newest first.",
  },
};

// Sourced from docs/CHANGELOG.md's Unreleased section (see
// scripts/generate-changelog-data.ts). The product-update email
// (src/lib/email/cron.ts) links each entry it mentions to its anchor here.
export default function ChangelogPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand">
          <BrandMark size={24} />
          <span className="privacy-wordmark">Ciciro</span>
        </Link>
        <div className="privacy-header-actions">
          <ThemeToggle />
          <BackLink fallback="/" />
        </div>
      </header>

      <article className="privacy-body">
        <p className="privacy-eyebrow">What&apos;s new</p>
        <h1 className="privacy-title">Changes to Ciciro, newest first</h1>

        {CHANGELOG_ENTRIES.length === 0 ? (
          <p className="privacy-lede">Nothing new yet.</p>
        ) : (
          <section className="privacy-section changelog-entries">
            {CHANGELOG_ENTRIES.map((entry) => (
              <article className="changelog-entry" key={entry.id} id={entry.id}>
                {entry.date ? (
                  <p className="changelog-date">{formatChangelogDate(entry.date)}</p>
                ) : null}
                <div className="changelog-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.text}</ReactMarkdown>
                </div>
              </article>
            ))}
          </section>
        )}
      </article>
    </main>
  );
}
