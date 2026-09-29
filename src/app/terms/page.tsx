import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import BackLink from "@/app/privacy/BackLink";
import "../privacy/privacy.css";

export const metadata: Metadata = {
  title: "Terms of Use - Ciciro",
  description: "The terms for using Ciciro and for Ciciro Pro subscriptions, on the web and in the apps.",
};

export default async function TermsPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href="/" className="privacy-brand">
          <BrandMark size={24} />
          <span className="privacy-wordmark">Ciciro</span>
        </Link>
        <BackLink fallback="/" />
      </header>

      <article className="privacy-body">
        <p className="privacy-eyebrow">Terms of Use</p>
        <h1 className="privacy-title">The terms for using Ciciro</h1>
        <p className="privacy-updated">Last updated September 2026.</p>

        <p className="privacy-lede">
          These terms cover your Ciciro account, on the web and in the iPhone and Android apps,
          and Ciciro Pro subscriptions. By creating an account or subscribing you agree to them.
          How Ciciro handles your writing is on the <Link href="/privacy">Privacy</Link> page,
          which is part of these terms.
        </p>

        <section className="privacy-section">
          <h2>Your writing is yours</h2>
          <p>
            You own what you write in Ciciro, and what Ciciro drafts for you at your request.
            Ciciro stores it only to run the service for you, and never uses it to train a
            model. You can export all of it, or delete your account and everything in it, from
            Settings at any time.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Your account</h2>
          <p>
            Keep your sign-in to yourself; you are responsible for what happens under your
            account. Don&apos;t use Ciciro to break the law, to infringe someone else&apos;s
            rights, to attack or overload the service, or to get around its limits. Ciciro may
            suspend an account that does.
          </p>
        </section>

        <section className="privacy-section">
          <h2>The AI editor</h2>
          <p>
            Ciciro&apos;s chat, drafting and checks come from AI models. They can be wrong,
            repetitive or inconsistent with your story, so read what they produce before you
            keep it. Each plan includes a monthly allowance of AI actions, shown in Settings and
            on the <Link href="/pricing">pricing</Link> page; it starts over on the first of
            each month (UTC) and unused actions don&apos;t carry over.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Ciciro Pro subscriptions</h2>
          <ul>
            <li>
              Ciciro Pro is billed monthly or yearly, at the price shown before you buy, and
              renews automatically at the end of each period until you cancel.
            </li>
            <li>
              Bought on the web: payment is handled by Stripe. Cancel any time from Settings,
              under Manage billing. Pro stays on until the end of the period you paid for.
            </li>
            <li>
              Bought in the iPhone app: payment is charged to your Apple ID when you confirm the
              purchase, and the subscription renews unless auto-renew is turned off at least 24
              hours before the period ends. Manage or cancel it in your App Store account
              settings. Apple&apos;s{" "}
              <a
                href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
                target="_blank"
                rel="noreferrer"
              >
                standard end user license agreement
              </a>{" "}
              also applies to the iPhone app.
            </li>
            <li>
              Bought in the Android app: payment and renewal are handled by Google Play. Manage
              or cancel it in the Play Store&apos;s subscriptions page.
            </li>
            <li>
              One subscription covers your account everywhere you sign in. Deleting your account
              cancels a web subscription immediately; a subscription bought through Apple or
              Google has to be cancelled with them.
            </li>
            <li>
              Refunds for App Store and Google Play purchases are handled by Apple and Google
              under their policies. For a web purchase, contact Ciciro support.
            </li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>Changes and availability</h2>
          <p>
            Ciciro is provided as it is, without a guarantee that it will always be available
            or free of mistakes. Features, plans and prices may change; a price change never
            applies to a period you have already paid for, and you will be told before it
            applies to your next renewal. If these terms change in a way that matters, Ciciro
            will say so in the app before the change applies.
          </p>
        </section>

        <p className="privacy-footnote">
          Like the privacy page, these terms are maintained alongside the code they describe.
          If something here looks out of date or wrong, that&apos;s a bug.
        </p>
      </article>
    </main>
  );
}
