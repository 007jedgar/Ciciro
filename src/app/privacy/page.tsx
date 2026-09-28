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
            not everyone does), some of your text is also sent to{" "}
            <a href="https://groq.com/terms-of-use/" target="_blank" rel="noreferrer">
              Groq
            </a>
            &apos;s API for two narrow jobs. The first is deciding whether a request is a
            quick lookup, a structural move, or real editorial work. For that, Groq receives
            your full chat message and, when you ask to move text between chapters, the
            passage involved: whatever you selected in the editor (at any length) and up to
            about 600 characters of chapter text following a stray chapter heading. The
            second is ranking chat-search results, where Groq receives the editor&apos;s search
            terms and a short snippet (about 160 characters) around each match in past
            messages, including cleared ones. Groq never receives your story bible or whole chapters you haven&apos;t
            selected, and it&apos;s advisory only - the editor still decides what to do. If
            no Groq key is set, or Groq has a problem, Ciciro falls back to Anthropic instead.
          </p>
          <p>
            Nobody else sees your manuscript as part of normal use. Ciciro has no analytics,
            telemetry, or error-reporting service wired in, and no email-sending is set up, so
            your writing can&apos;t end up in an analytics dashboard or an email body.
            Dictation and read-aloud use your device&apos;s or browser&apos;s built-in speech
            engine, not a cloud voice API Ciciro talks to. That engine may still process your
            voice on its maker&apos;s servers: in the phone app, dictation can go to Apple or
            Google under your phone&apos;s speech-recognition settings, and in a browser like
            Chrome, the browser may send the audio to Google. That happens between your device
            and its maker, not through Ciciro.
          </p>
        </section>

        <section className="privacy-section">
          <h2>What Ciciro stores</h2>
          <p>Ciciro&apos;s database is where your manuscript actually lives. It keeps, for as long as your account exists:</p>
          <ul>
            <li>Chapter text, and the version history (snapshots) behind it</li>
            <li>Story bible files - characters, plot points, open questions, notes</li>
            <li>Chat history with the editor, including AI-generated drafts and edits</li>
            <li>
              Full transcripts of each editor run, including any text you had selected and
              the chapter text the editor read along the way
            </li>
            <li>The exact find-and-replace text of every correction the editor made</li>
            <li>Scratch notes, weekly reviews, and the &ldquo;Previously on&rdquo; recap of each manuscript</li>
            <li>Writing stats: words written and time spent per day and per sitting</li>
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
            editor run transcripts, notes, recaps, and any share links tied to it. Your daily
            writing stats belong to your account rather than a manuscript, so deleting a
            manuscript leaves them in place. Archiving a chapter hides it without deleting it
            outright, so you can bring it back; an empty chapter can be deleted directly.
            Clearing a chat thread archives those messages rather than deleting them: they
            leave the conversation and the editor stops reading them back, but they stay in
            the database, Undo can restore them, and the editor&apos;s chat search can still
            find them. They&apos;re only removed when the whole manuscript is deleted.
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
