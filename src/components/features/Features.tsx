import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import ThemeToggle from "@/components/ThemeToggle";
import TrackedLink from "@/components/TrackedLink";
import Exhibit from "@/components/landing/Exhibit";
import Scene from "@/components/landing/Scene";
import { stripeSettings } from "@/lib/billing/config";
import "@/components/landing/landing.css";
import "./features.css";
import { FEATURES_CLOSING, FEATURES_HERO, FEATURES_SECTIONS, type FeatureSection } from "./copy";

function Arrow() {
  return (
    <span className="landing-arrow" aria-hidden>
      →
    </span>
  );
}

function Brand() {
  return (
    <Link href="/" className="landing-brand" aria-label="Ciciro home">
      <BrandMark size={34} />
      <span className="landing-wordmark">Ciciro</span>
    </Link>
  );
}

function Section({ section }: { section: FeatureSection }) {
  return (
    <section className="landing-wrap landing-block" aria-labelledby={`features-${section.id}`}>
      <p className="landing-kicker">{section.kicker}</p>
      <h2 id={`features-${section.id}`} className="landing-h2">
        {section.headingLead} <em>{section.headingKey}</em>
      </h2>
      {section.intro ? <p className="features-intro">{section.intro}</p> : null}
      <div className={section.exhibit ? "features-split" : undefined}>
        <ul className="features-grid">
          {section.items.map((item) => (
            <li key={item.headline} className="features-card">
              <h3>
                {item.headline}
                {item.badge ? <span className="features-badge">{item.badge}</span> : null}
              </h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
        {section.exhibit ? (
          <div className="features-exhibit">
            <Exhibit exhibit={section.exhibit} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function Features() {
  // /pricing exists only where the web sells Pro (docs/billing.md); mirror
  // Landing.tsx's selling gate so no Pro/upgrade language shows without it.
  const selling = stripeSettings() !== null;

  return (
    <main className="landing">
      <div className="landing-band">
        <div className="landing-wrap">
          <header className="landing-header">
            <Brand />
            <nav className="landing-nav" aria-label="Account">
              {selling ? (
                <Link href="/pricing" className="landing-plain-link">
                  Pricing
                </Link>
              ) : null}
              <TrackedLink href="/login" className="landing-plain-link" cta="sign_in_nav" surface="features">
                Sign in
              </TrackedLink>
              <ThemeToggle className="landing-theme-toggle" />
              <TrackedLink
                href="/signup"
                className="landing-btn landing-btn-light landing-btn-small"
                cta="get_early_access_nav"
                surface="features"
              >
                Get early access <Arrow />
              </TrackedLink>
            </nav>
          </header>
          <section className="landing-hero features-hero" aria-labelledby="features-headline">
            <div>
              <p className="landing-eyebrow">{FEATURES_HERO.eyebrow}</p>
              <h1 id="features-headline" className="landing-h1">
                {FEATURES_HERO.headingLead} <em>{FEATURES_HERO.headingKey}</em>
              </h1>
              <p className="landing-sub">{FEATURES_HERO.sub}</p>
              <ul className="landing-chips">
                {FEATURES_HERO.chips.map((chip) => (
                  <li key={chip}>{chip}</li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>

      <div className="landing-wrap landing-folder-zone">
        <Scene />
      </div>

      {FEATURES_SECTIONS.map((section) => (
        <Section key={section.id} section={section} />
      ))}

      <div className="landing-closing">
        <div className="landing-wrap">
          <section className="landing-closing-inner" aria-labelledby="features-closing">
            <div>
              <p className="landing-kicker landing-kicker-band">{FEATURES_CLOSING.kicker}</p>
              <h2 id="features-closing" className="landing-h2">
                {FEATURES_CLOSING.headingLead} <em>{FEATURES_CLOSING.headingKey}</em>
              </h2>
              <p className="landing-closing-sub">{FEATURES_CLOSING.sub}</p>
            </div>
            <div className="landing-form-actions features-closing-actions">
              <TrackedLink href="/signup" className="landing-btn" cta="get_early_access_features" surface="features">
                Get early access <Arrow />
              </TrackedLink>
              <TrackedLink
                href="/login"
                className="landing-inline-link"
                cta="sign_in_features_closing"
                surface="features"
              >
                I already have an account
              </TrackedLink>
            </div>
          </section>
          <footer className="landing-footer">
            <Brand />
            <nav className="landing-footer-nav" aria-label="Footer">
              <Link href="/login">Sign in</Link>
              <Link href="/signup">Get early access</Link>
              {selling ? <Link href="/pricing">Pricing</Link> : null}
              <Link href="/changelog">What&apos;s new</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </nav>
            <span className="landing-footer-note">Ciciro is in early access. © {new Date().getFullYear()}.</span>
          </footer>
        </div>
      </div>
    </main>
  );
}
