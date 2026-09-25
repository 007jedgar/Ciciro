import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import "./launch.css";

export const metadata: Metadata = {
  title: "Ciciro - a reason to open the file again tomorrow",
  description:
    "Ciciro checks in - daily or weekly - and drops you back into the exact sentence you left, from desk to phone. Five minutes is enough to keep a novel alive.",
};

export default function LaunchPage() {
  return (
    <main className="launch-page" data-theme="parchment">
      <div className="launch-halo" aria-hidden="true" />
      <div className="launch-grain" aria-hidden="true" />

      <header className="launch-header">
        <div className="launch-brand">
          <BrandMark size={26} />
          <span className="launch-wordmark">Ciciro</span>
        </div>
        <nav className="launch-nav">
          <Link href="/login" className="launch-link">
            Sign in
          </Link>
          <Link href="/signup" className="launch-cta-small">
            Get early access
          </Link>
        </nav>
      </header>

      <section className="launch-hero">
        <div className="launch-hero-copy">
          <p className="launch-eyebrow">For writers who keep meaning to get back to it</p>
          <h1 className="launch-headline">
            Most novels don&apos;t stall from writer&apos;s block. They stall from silence.
          </h1>
          <p className="launch-subhead">
            Ciciro checks in - daily or weekly, your call - and drops you back into the
            exact sentence you left, on your phone. Five minutes is enough to keep going.
          </p>
          <div className="launch-actions">
            <Link href="/signup" className="launch-cta">
              Get early access
            </Link>
            <Link href="/login" className="launch-cta-ghost">
              Sign in
            </Link>
          </div>
          <ul className="launch-chips">
            <li>Daily or weekly nudges</li>
            <li>Resumes mid-sentence</li>
            <li>Five minutes counts</li>
          </ul>
        </div>

        <div className="launch-handoff" aria-hidden="true">
          <div className="launch-desk">
            <div className="launch-desk-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="launch-desk-page">
              <p className="launch-ms-line">Mara took the letter from her coat pocket, the</p>
              <p className="launch-ms-line">paper gone soft at the folds. She didn&apos;t need to</p>
              <p className="launch-ms-line launch-desk-tail">
                unfold it, only to feel the
                <span className="launch-caret-window launch-caret-desk">
                  <span className="launch-caret" />
                </span>
              </p>
            </div>
          </div>

          <svg className="launch-arc-svg" viewBox="0 0 560 340" aria-hidden="true">
            <path
              id="launch-arc-path"
              className="launch-arc-path"
              d="M 330 210 C 400 260, 420 250, 452 232"
              fill="none"
            />
            <circle className="launch-arc-dot" r="5" />
          </svg>

          <div className="launch-phone">
            <div className="launch-phone-notch" />
            <div className="launch-nudge">
              <span className="launch-nudge-dot" />
              Time to write - day 12
            </div>
            <div className="launch-phone-page">
              <p className="launch-ms-line launch-ms-line-small">
                &hellip;only to feel the
              </p>
              <p className="launch-ms-line launch-ms-line-small">
                <span className="launch-reveal">weight of it, warm from</span>
              </p>
              <p className="launch-ms-line launch-ms-line-small">
                <span className="launch-reveal launch-reveal-2">her pocket.</span>
                <span className="launch-caret-window launch-caret-phone">
                  <span className="launch-caret" />
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="launch-how" aria-labelledby="launch-how-heading">
        <h2 id="launch-how-heading" className="launch-section-heading">
          How Ciciro keeps you writing
        </h2>
        <div className="launch-how-grid">
          <div className="launch-how-card">
            <span className="launch-how-index">01</span>
            <h3>A nudge, not a deadline</h3>
            <p>
              Daily or weekly, Ciciro reminds you it&apos;s time to write. Aim for a few
              days in the last seven — rest days are built in, so nothing resets to zero
              when you miss one.
            </p>
          </div>
          <div className="launch-how-card">
            <span className="launch-how-index">02</span>
            <h3>Picks up mid-sentence</h3>
            <p>
              Open it on your phone and you&apos;re back in the paragraph you left, not a
              blank page or a dashboard you have to think your way into.
            </p>
          </div>
          <div className="launch-how-card">
            <span className="launch-how-index">03</span>
            <h3>Five minutes is a session</h3>
            <p>
              Add one line from the couch. It&apos;s saved, it counts, and it&apos;s
              waiting for you next time - on the desk or the phone.
            </p>
          </div>
        </div>
      </section>

      <section className="launch-why" aria-labelledby="launch-why-heading">
        <div className="launch-why-copy">
          <h2 id="launch-why-heading" className="launch-section-heading">
            Not another blank document
          </h2>
          <p>
            Most writing tools assume you&apos;ll show up with an hour and momentum.
            Ciciro assumes the opposite: you&apos;ll show up tired, mid-thought, on
            whatever device is in your hand. It holds the sentence, the chapter, and
            who your characters are so you don&apos;t have to reload the whole book in
            your head before you can add to it.
          </p>
        </div>
        <ul className="launch-why-list">
          <li>Chapters and character notes stay in one place, not six tabs</li>
          <li>Edits sync the moment you make them - no export, no merge</li>
          <li>Works the same whether you write in bursts or a paragraph a day</li>
        </ul>
      </section>

      <section className="launch-final-cta">
        <h2 className="launch-final-headline">Start the habit tonight.</h2>
        <p className="launch-final-sub">
          Early access is open. Bring the sentence you already started.
        </p>
        <Link href="/signup" className="launch-cta">
          Get early access
        </Link>
      </section>

      <footer className="launch-footer">
        <div className="launch-brand">
          <BrandMark size={20} />
          <span className="launch-wordmark">Ciciro</span>
        </div>
        <nav className="launch-footer-nav">
          <Link href="/login" className="launch-link">
            Sign in
          </Link>
          <Link href="/signup" className="launch-link">
            Get early access
          </Link>
        </nav>
        <p className="launch-footer-note">Ciciro is in early access. &copy; {new Date().getFullYear()}.</p>
      </footer>
    </main>
  );
}
