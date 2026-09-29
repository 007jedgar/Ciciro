import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import CyclingWord from "./CyclingWord";
import { openEarlyAccess, planLimits, stripeSettings } from "@/lib/billing/config";
import { CLOSING, HERO, HOW, PRICING, SCENE, WHY } from "./copy";
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

/** The desk-to-phone handoff: a punched manuscript sheet in a cobalt folder,
    the phone that picks the sentence up, and the nudge that brought you back. */
function Scene() {
  return (
    <div className="landing-folder">
      <div className="landing-tabs" aria-hidden>
        <span className="landing-tab landing-tab-v">Chapter 12</span>
        <span className="landing-tab landing-tab-b">Characters</span>
        <span className="landing-tab landing-tab-y">Outline</span>
      </div>
      <div className="landing-scene" aria-hidden>
        <div className="landing-sheet">
          <div className="landing-holes">
            <i />
            <i />
            <i />
          </div>
          <div className="landing-sheet-head">
            <span className="landing-sheet-title">The Letter</span>
            <span className="landing-file-no">CH. 12</span>
          </div>
          <p className="landing-ms">
            The harbour had gone quiet by the time she reached the steps, and the lamps were only
            just coming on along the wall.
          </p>
          <p className="landing-ms landing-ms-live">
            Mara took the letter from her coat pocket, the paper gone soft at the folds. She
            didn&apos;t need to unfold it, only to feel the
            <span className="landing-caret landing-caret-desk" />
          </p>
          <div className="landing-sheet-foot">
            <span>Last kept: desk, 9:12 pm</span>
            <span>p. 214</span>
          </div>
        </div>
        <div className="landing-phone">
          <div className="landing-screen">
            <div className="landing-screen-meta">
              <span>Thursday</span>
              <span>9:41</span>
            </div>
            <div className="landing-reminder">
              <span className="landing-reminder-app">
                <span className="landing-reminder-icon">
                  <i />
                  <i />
                  <i />
                </span>
                Ciciro
              </span>
              <b>{SCENE.reminderTitle}</b>
              <span>{SCENE.reminderBody}</span>
              <span className="landing-reminder-nudge">{SCENE.reminderNudge}</span>
            </div>
            <p>
              ...only to feel the{" "}
              <span className="landing-type-in">weight of it, warm from her pocket.</span>
              <span className="landing-caret landing-caret-phone" />
            </p>
          </div>
        </div>
        <div className="landing-receipt">
          <span className="landing-receipt-big">THIS WEEK</span>
          Aiming for 4 days.
          <br />
          Rest days are part of it.
          <span className="landing-receipt-row">
            <span>LAST 7 DAYS</span>
            <span>3 WRITTEN</span>
          </span>
          <span className="landing-receipt-row">
            <span>STREAK</span>
            <span>NONE KEPT</span>
          </span>
        </div>
        <svg className="landing-clip" viewBox="0 0 20 56">
          <path d="M6 44 V10 a4 4 0 0 1 8 0 V48 a6 6 0 0 1 -12 0 V14" />
        </svg>
        <svg className="landing-stamp" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="56" strokeWidth="3" />
          <circle cx="60" cy="60" r="40" strokeWidth="1.5" />
          <defs>
            <path id="landing-stamp-ring" d="M60 60 m-48 0 a48 48 0 1 1 96 0 a48 48 0 1 1 -96 0" />
          </defs>
          <text>
            <textPath href="#landing-stamp-ring">COUNTED · CICIRO · COUNTED · CICIRO ·</textPath>
          </text>
          <text x="60" y="66" textAnchor="middle" className="landing-stamp-center">
            5 MIN
          </text>
        </svg>
      </div>
    </div>
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
          <Link href="/pricing" className="landing-btn">
            See pricing <Arrow />
          </Link>
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
              <Link href="/login" className="landing-plain-link">
                Sign in
              </Link>
              <Link href="/signup" className="landing-btn landing-btn-light landing-btn-small">
                Get early access <Arrow />
              </Link>
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
              <Link href="/signup" className="landing-btn">
                Get early access <Arrow />
              </Link>
              <Link href="/login" className="landing-btn landing-btn-outline">
                Sign in
              </Link>
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
        <div className="landing-files">
          {HOW.items.map((item, i) => (
            <article key={item.title} className={`landing-file landing-file-${i + 1}`}>
              <span className="landing-file-tab">{item.tab}</span>
              <span className="landing-file-num" aria-hidden>
                {item.numeral}
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
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
      </section>

      {selling ? <Pricing offerOpen={offerOpen} /> : null}

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
                <Link href="/signup" className="landing-btn">
                  Get early access <Arrow />
                </Link>
                <Link href="/login" className="landing-inline-link">
                  I already have an account
                </Link>
              </div>
            </div>
          </section>
          <footer className="landing-footer">
            <Brand />
            <nav className="landing-footer-nav" aria-label="Footer">
              <Link href="/login">Sign in</Link>
              <Link href="/signup">Get early access</Link>
              {selling ? <Link href="/pricing">Pricing</Link> : null}
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
