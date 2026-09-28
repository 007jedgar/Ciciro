import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import "./privacy.css";

export const metadata: Metadata = {
  title: "Privacy - Ciciro",
  description: "Who sees your manuscript, what Ciciro stores, and what it never does with your writing.",
};

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand">
          <BrandMark size={24} />
          <span className="privacy-wordmark">Ciciro</span>
        </Link>
        <Link href="/" className="privacy-back">
          Back
        </Link>
      </header>

      <article className="privacy-body">
        <p className="privacy-eyebrow">Privacy, in plain language</p>
        <h1 className="privacy-title">Who sees your manuscript, and what Ciciro does with it</h1>
        <p className="privacy-updated">Last updated September 2026.</p>

        <p className="privacy-lede">
          This isn&apos;t a legal document - it&apos;s a straight answer to the question every
          writer asks before pasting a manuscript into a tool: who sees this, where does it
          live, and does anything train on it. It describes how Ciciro&apos;s code actually
          works today.
        </p>

        <section className="privacy-section">
          <h2>Who sees your manuscript</h2>
          <p>
            When you use Ciciro&apos;s editor, chat, or autowrite, your chapter text, story
            bible, and conversation are sent to{" "}
            <a href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noreferrer">
              Anthropic
            </a>
            &apos;s API so Claude can read and respond to them. That happens every time you ask
            the editor to do something - it&apos;s the core of the product.
          </p>
          <p>
            If the operator running this Ciciro instance has set up a Groq key (optional -
            not everyone does), short excerpts of your chat messages and chat-search results
            are sent to{" "}
            <a href="https://groq.com/terms-of-use/" target="_blank" rel="noreferrer">
              Groq
            </a>
            &apos;s API for two narrow jobs: deciding whether a request is a quick lookup or
            real editorial work, and ranking chat-search results. Groq never sees your full
            chapters or story bible, and it&apos;s advisory only - the editor still decides
            what to do. If no Groq key is set, or Groq has a problem, Ciciro falls back to
            Anthropic instead.
          </p>
          <p>
            Nobody else sees your manuscript as part of normal use. Ciciro has no analytics,
            telemetry, or error-reporting service wired in, and no email-sending is set up, so
            your writing can&apos;t end up in an analytics dashboard or an email body. Dictation
            and read-aloud run on your device&apos;s or browser&apos;s own speech engine, not a
            cloud voice API Ciciro talks to - though if you use dictation in a browser like
            Chrome, that browser may itself send the audio to Google&apos;s speech servers under
            Google&apos;s own terms; that happens between your browser and Google, not through
            Ciciro.
          </p>
        </section>

        <section className="privacy-section">
          <h2>What Ciciro stores</h2>
          <p>Ciciro&apos;s database is where your manuscript actually lives. It keeps, for as long as your account exists:</p>
          <ul>
            <li>Chapter text, and the version history (snapshots) behind it</li>
            <li>Story bible files - characters, plot points, open questions, notes</li>
            <li>Chat history with the editor, including AI-generated drafts and edits</li>
            <li>Comments left on anything you&apos;ve shared, and the share links themselves</li>
            <li>Your account email and password hash - never the plain password</li>
          </ul>
          <p>
            That&apos;s the whole point of the product: Ciciro is where your manuscript is
            supposed to live between sessions, not a pass-through to someone else&apos;s
            servers.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Sharing your manuscript</h2>
          <p>
            A share link is something you create on purpose, to send a chapter or a whole
            manuscript to a beta reader. Anyone who has that link can read what it covers
            without signing in - that&apos;s how it&apos;s designed to work. You can revoke a
            share link at any time, and revoking it is permanent: once revoked, the link stops
            working exactly as if it never existed. Deleting a share link also deletes every
            comment left through it.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Deleting your data</h2>
          <p>
            Deleting a manuscript removes its chapters, snapshots, story bible, chat history,
            and any share links tied to it. Archiving a chapter hides it without deleting it
            outright, so you can bring it back; an empty chapter can be deleted directly.
            Clearing a chat thread deletes those messages outright, not just hides them.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Training</h2>
          <p>
            Ciciro itself does not use your manuscript, chat messages, or any other data to
            train a model, and never will - there&apos;s no training pipeline in this product
            at all. What Anthropic and Groq do with the text their APIs process is governed by
            their own published terms, not by Ciciro, and those terms can change. Read them
            directly rather than taking Ciciro&apos;s word for it:{" "}
            <a href="https://www.anthropic.com/legal/commercial-terms" target="_blank" rel="noreferrer">
              Anthropic&apos;s commercial terms
            </a>{" "}
            and{" "}
            <a href="https://groq.com/terms-of-use/" target="_blank" rel="noreferrer">
              Groq&apos;s terms of use
            </a>
            .
          </p>
        </section>

        <p className="privacy-footnote">
          This page is maintained alongside the code it describes. If something here looks out
          of date or wrong, that&apos;s a bug - not a clause to interpret around.
        </p>
      </article>
    </main>
  );
}
