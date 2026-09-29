import VerifyEmailConfirm from "@/components/VerifyEmailConfirm";
import { getSessionUser } from "@/lib/auth/session";
import { peekVerification } from "@/lib/auth/verify-email";

export const metadata = { title: "Confirm your email - Ciciro" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ token?: string }> };

// Where the verification email lands. Only looks the link up; the button's
// POST is what spends it, so a mail scanner opening the link changes nothing.
export default async function VerifyEmailPage({ searchParams }: Props) {
  const token = (await searchParams).token ?? "";
  const initial = await peekVerification(token);
  const user = await getSessionUser().catch(() => null);
  return (
    <VerifyEmailConfirm
      token={token}
      initial={initial}
      user={user ? { email: user.email, emailVerified: Boolean(user.emailVerified) } : null}
    />
  );
}
