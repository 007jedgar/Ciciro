import { headers } from "next/headers";
import Link from "next/link";
import AuthPanel from "@/components/AuthPanel";
import ResendVerificationButton from "@/components/ResendVerificationButton";
import { getSessionUser } from "@/lib/auth/session";
import { verifyEmail, type VerifyOutcome } from "@/lib/auth/verify-email";
import { originFromHeaders, publicOrigin } from "@/lib/public-origin";

export const metadata = { title: "Confirm your email - Ciciro" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ token?: string }> };

const COPY: Record<VerifyOutcome, { title: string; body: string }> = {
  verified: {
    title: "Your email is confirmed",
    body: "Thanks. We'll use this address for anything about your account, like resetting your password.",
  },
  already_verified: {
    title: "Already confirmed",
    body: "This address was confirmed earlier, so there's nothing more to do.",
  },
  expired: {
    title: "This link has expired",
    body: "Confirmation links work for 48 hours. Send yourself a new one and use that instead.",
  },
  invalid: {
    title: "This link won't work",
    body: "It may have been copied incompletely, or replaced by a newer email. Send yourself a new one.",
  },
};

// Where the verification email lands. Opening it is what verifies: the link
// proves whoever opened it reads that inbox, even a mail scanner doing so.
export default async function VerifyEmailPage({ searchParams }: Props) {
  const token = (await searchParams).token ?? "";
  const origin = publicOrigin(originFromHeaders(await headers()));
  const result = await verifyEmail(token, origin);
  const user = await getSessionUser().catch(() => null);
  // A dead link is moot for someone signed in whose address is already confirmed.
  const outcome = result !== "verified" && user?.emailVerified ? "already_verified" : result;
  const copy = COPY[outcome];
  const ok = outcome === "verified" || outcome === "already_verified";

  return (
    <AuthPanel title={copy.title}>
      <p className="auth-lede" role={ok ? "status" : "alert"}>
        {copy.body}
      </p>
      {ok ? (
        <>
          <Link className="btn primary" href="/">
            {user ? "Back to your manuscripts" : "Open Ciciro"}
          </Link>
          <p className="auth-alt">On your phone? You can go back to the Ciciro app.</p>
        </>
      ) : user && !user.emailVerified ? (
        <ResendVerificationButton email={user.email} />
      ) : (
        <>
          <Link className="btn primary" href="/login">
            Sign in to send a new link
          </Link>
          <p className="auth-alt">Then choose Resend under Account in settings.</p>
        </>
      )}
    </AuthPanel>
  );
}
