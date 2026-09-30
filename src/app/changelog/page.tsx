import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import ThemeToggle from "@/components/ThemeToggle";
import BackLink from "@/app/privacy/BackLink";
import { CHANGELOG_ENTRIES } from "@/lib/changelog-data.generated";
import "../privacy/privacy.css";

export const metadata: Metadata = {
  title: "What's new - Ciciro",
  description: "New features and changes in Ciciro, newest first.",
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
        <p className="privacy-eyebrow">What's new</p>
        <h1 className="privacy-title">Changes to Ciciro, newest first</h1>

        {CHANGELOG_ENTRIES.length === 0 ? (
          <p className="privacy-lede">Nothing new yet.</p>
        ) : (
          <section className="privacy-section">
            {CHANGELOG_ENTRIES.map((entry) => (
              <p key={entry.id} id={entry.id}>
                {entry.text}
              </p>
            ))}
          </section>
        )}
      </article>
    </main>
  );
}
