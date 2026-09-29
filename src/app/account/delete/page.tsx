import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { DELETED_WITH_ACCOUNT } from "@/lib/account/copy";
import { authRequired } from "@/lib/auth/constants";
import { getSessionUser } from "@/lib/auth/session";
import BackLink from "../../privacy/BackLink";
import AccountDeleteActions from "./AccountDeleteActions";
import "../../privacy/privacy.css";

export const metadata: Metadata = {
  title: "Delete your account - Ciciro",
  description: "How to delete your Ciciro account and everything in it, and what happens to your data.",
};

type Props = { searchParams: Promise<{ deleted?: string }> };

// Public: linked from the app stores' data-deletion listings, so it has to
// explain the process to someone who is not signed in (see src/middleware.ts).
export default async function AccountDeletePage({ searchParams }: Props) {
  const user = await getSessionUser().catch(() => null);
  const justDeleted = (await searchParams).deleted === "1" && !user;
  const home = !authRequired() || user ? "/" : "/launch";

  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link href={home} className="privacy-brand">
          <BrandMark size={24} />
          <span className="privacy-wordmark">Ciciro</span>
        </Link>
        <BackLink fallback={home} />
      </header>

      <article className="privacy-body">
        <p className="privacy-eyebrow">Your account</p>
        <h1 className="privacy-title">Deleting your Ciciro account</h1>

        {justDeleted ? (
          <div className="account-delete-done" role="status">
            <h2>Your account has been deleted</h2>
            <p>
              Everything in it is gone from Ciciro, and every device that was signed in to it has
              been signed out. Thank you for writing here.
            </p>
          </div>
        ) : null}

        <p className="privacy-lede">
          You can delete your account at any time, from the app or the web. Deleting it removes
          everything you have written and stored in Ciciro, straight away, and can&apos;t be
          undone.
        </p>

        <section className="privacy-section">
          <h2>How to delete it</h2>
          <ul>
            <li>
              <strong>In the iPhone or Android app:</strong> open Settings from your manuscripts,
              then tap Delete account.
            </li>
            <li>
              <strong>On the web:</strong> sign in, open settings from the appearance button at the
              top right, and choose Delete account. You can also do it right here.
            </li>
          </ul>
          <p>You&apos;ll be asked for your password to confirm.</p>
          {user ? <AccountDeleteActions email={user.email} /> : null}
          {!user && !justDeleted ? (
            <div className="account-delete-actions">
              <Link className="btn primary" href="/login?next=/account/delete">
                Sign in to delete your account
              </Link>
            </div>
          ) : null}
        </section>

        <section className="privacy-section">
          <h2>What gets deleted</h2>
          <ul>
            {DELETED_WITH_ACCOUNT.map((item) => (
              <li key={item}>{item}</li>
            ))}
            <li>Your account itself: your email address, name and password</li>
          </ul>
          <p>
            Beta readers lose access to anything you shared the moment the account is deleted.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Keep a copy first</h2>
          <p>
            Export my data, in the same settings, downloads one zip with every manuscript as a
            Word document and as Markdown, its story bible and scratch notes, and everything else
            Ciciro stores for you as JSON. Download it before you delete: afterwards there is
            nothing left to export.
          </p>
        </section>

        <section className="privacy-section">
          <h2>What happens afterwards</h2>
          <p>
            Ciciro keeps nothing from a deleted account. Its database host keeps point-in-time
            backups for up to 30 days to recover from outages, so deleted data leaves those
            backups within 30 days. Text that was sent to Anthropic or Groq while you used the
            editor is handled under their terms; the <Link href="/privacy">privacy page</Link>{" "}
            explains what they receive.
          </p>
        </section>
      </article>
    </main>
  );
}
