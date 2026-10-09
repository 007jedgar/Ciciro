import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import ThemeToggle from "@/components/ThemeToggle";
import TrackedLink from "@/components/TrackedLink";
import CyclingWord from "./CyclingWord";
import Exhibit from "./Exhibit";
import Scene from "./Scene";
import { openEarlyAccess, planLimits, stripeSettings } from "@/lib/billing/config";
import BetaSignupForm from "./BetaSignupForm";
import { BETA, CLOSING, HERO, HOW, PRICING, WHY } from "./copy";
import "./landing.css";

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

/** Free and Pro at a glance. Amounts live in Stripe, so this links to them
    rather than fetching them on every visit. */
function Pricing({ offerOpen }: { offerOpen: boolean }) {
  return (
    <section className="landing-wrap landing-block" aria-labelledby="landing-pricing">
      <p className="landing-kicker">{PRICING.kicker} / Form CI-02</p>
      <div className="landing-pricing">
        <div>
          <h2 id="landing-pricing" className="landing-h2">
            {PRICING.headingLead} <em>{PRICING.headingKey}</em>
          </h2>
          <p className="landing-pricing-body">{PRICING.body}</p>
        </div>
        <div className="landing-price-sheet">
          <div className="landing-price-row">
            <span>Free</span>
            <b>$0, always</b>
          </div>
          <p>{PRICING.free(planLimits("free").aiRunsPerMonth)}</p>
          <div className="landing-price-row">
            <span>Ciciro Pro</span>
            <b>Monthly or yearly</b>
          </div>
          <p>{PRICING.pro}</p>
          {offerOpen ? <p className="landing-price-offer">{PRICING.offer}</p> : null}
          <TrackedLink href="/pricing" className="landing-btn" cta="see_pricing" surface="landing">
            See pricing <Arrow />
          </TrackedLink>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  // /pricing exists only where the web sells Pro (docs/billing.md).
  const selling = stripeSettings() !== null;
  const offerOpen = selling && openEarlyAccess() !== null;
  return (
    <main className="landing">
      <div className="landing-band">
        <div className="landing-wrap">
          <div className="landing-meta" aria-hidden>
            <span>M_12</span>
            <span>Early access / Vol. 01</span>
            <span>Filed {new Date().getFullYear()}</span>
          </div>
          <header className="landing-header">
            <Brand />
            <nav className="landing-nav" aria-label="Account">
              {selling ? (
                <Link href="/pricing" className="landing-plain-link">
                  Pricing
                </Link>
              ) : null}
              <TrackedLink href="/login" className="landing-plain-link" cta="sign_in_nav" surface="landing">
                Sign in
              </TrackedLink>
              <ThemeToggle className="landing-theme-toggle" />
              <TrackedLink
                href="/signup"
                className="landing-btn landing-btn-light landing-btn-small"
                cta="get_early_access_nav"
                surface="landing"
              >
                Get early access <Arrow />
              </TrackedLink>
            </nav>
          </header>
          <section className="landing-hero" aria-labelledby="landing-headline">
            <div>
              <p className="landing-eyebrow">{HERO.eyebrow}</p>
              <h1 id="landing-headline" className="landing-h1">
                <span className="landing-sr">
                  {`${HERO.headlineStart} ${HERO.headlineSubjects[0]} ${HERO.headlineLead} ${HERO.headlineKey}`}
                </span>
                <span aria-hidden>
                  {HERO.headlineStart} <CyclingWord words={HERO.headlineSubjects} /> {HERO.headlineLead}{" "}
                  <em>{HERO.headlineKey}</em>
                </span>
              </h1>
            </div>
            <p className="landing-side-note">
              <b>{HERO.sideNoteTitle}</b>
              {HERO.sideNote}
            </p>
          </section>
          <div className="landing-hero-sub">
            <div>
              <p className="landing-sub">{HERO.sub}</p>
              <ul className="landing-chips">
                {HERO.chips.map((chip) => (
                  <li key={chip}>{chip}</li>
                ))}
              </ul>
            </div>
            <div className="landing-actions">
              <TrackedLink href="/signup" className="landing-btn" cta="get_early_access_hero" surface="landing">
                Get early access <Arrow />
              </TrackedLink>
              <TrackedLink
                href="/login"
                className="landing-btn landing-btn-outline"
                cta="sign_in_hero"
                surface="landing"
              >
                Sign in
              </TrackedLink>
            </div>
          </div>
        </div>
      </div>

      <div className="landing-wrap landing-folder-zone">
        <Scene />
      </div>

      <section className="landing-wrap landing-block" aria-labelledby="landing-how">
        <p className="landing-kicker">
          {HOW.kicker} / {HOW.items.length} entries
        </p>
        <h2 id="landing-how" className="landing-h2">
          {HOW.headingLead} <em>{HOW.headingKey}</em>
        </h2>
        <div className="landing-cases">
          {HOW.items.map((item, i) => (
            <div key={item.title} className="landing-case">
              <article className={`landing-file landing-file-${i + 1}`}>
                <span className="landing-file-tab">{item.tab}</span>
                <span className="landing-file-num" aria-hidden>
                  {item.numeral}
                </span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
              <Exhibit exhibit={item.exhibit} />
            </div>
          ))}
        </div>
      </section>

      <section className="landing-wrap landing-block" aria-labelledby="landing-why">
        <p className="landing-kicker">{WHY.kicker} / Excerpt A</p>
        <div className="landing-excerpt">
          <div className="landing-blush">
            <h2 id="landing-why" className="landing-h2">
              {WHY.headingLead} <em>{WHY.headingKey}</em>
            </h2>
            <p>{WHY.body}</p>
            <div className="landing-blush-foot">
              <span>Excerpt A</span>
              <span>Filed under: habit</span>
            </div>
          </div>
          <div className="landing-tall-receipt">
            <span className="landing-tall-receipt-title">{WHY.receiptTitle.toUpperCase()}</span>
            <span className="landing-tall-receipt-sub">CICIRO / RECEIPT 0012</span>
            <ul>
              {WHY.receipt.map((line, i) => (
                <li key={line}>
                  <b>{String(i + 1).padStart(2, "0")}</b>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <span className="landing-tall-receipt-total">
              <span>{WHY.receiptTotal[0].toUpperCase()}</span>
              <span>{WHY.receiptTotal[1].toUpperCase()}</span>
            </span>
          </div>
        </div>
        <div className="landing-why-exhibit">
          <Exhibit exhibit={WHY.exhibit} />
        </div>
      </section>

      {selling ? <Pricing offerOpen={offerOpen} /> : null}

      <section className="landing-wrap landing-block" aria-labelledby="landing-beta">
        <p className="landing-kicker">{BETA.kicker}</p>
        <div className="landing-beta">
          <div>
            <h2 id="landing-beta" className="landing-h2">
              {BETA.headingLead} <em>{BETA.headingKey}</em>
            </h2>
            <p className="landing-beta-body">{BETA.body}</p>
          </div>
          <BetaSignupForm />
        </div>
      </section>

      <div className="landing-closing">
        <div className="landing-wrap">
          <section className="landing-closing-inner" aria-labelledby="landing-closing">
            <div>
              <p className="landing-kicker landing-kicker-band">{CLOSING.kicker}</p>
              <h2 id="landing-closing" className="landing-h2">
                {CLOSING.headingLead} <em>{CLOSING.headingKey}</em>
              </h2>
              <p className="landing-closing-sub">{CLOSING.sub}</p>
            </div>
            <div className="landing-form-card">
              <div className="landing-form-meta">
                <span>Form CI-01</span>
                <span>Early access</span>
              </div>
              <div className="landing-form-line">
                <span>You</span>
                <em>a writer with a draft that went quiet</em>
              </div>
              <div className="landing-form-line">
                <span>Time needed</span>
                <em>five minutes, tonight</em>
              </div>
              <div className="landing-form-actions">
                <TrackedLink href="/signup" className="landing-btn" cta="get_early_access_closing" surface="landing">
                  Get early access <Arrow />
                </TrackedLink>
                <TrackedLink
                  href="/login"
                  className="landing-inline-link"
                  cta="sign_in_closing"
                  surface="landing"
                >
                  I already have an account
                </TrackedLink>
              </div>
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
            <span className="landing-footer-note">
              Ciciro is in early access. © {new Date().getFullYear()}.
            </span>
          </footer>
        </div>
      </div>
    </main>
  );
}
