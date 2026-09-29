import Link from "next/link";
import AuthPanel from "@/components/AuthPanel";
import ResetPasswordForm from "@/components/ResetPasswordForm";
import { checkEmailToken } from "@/lib/auth/email-tokens";
import { RESET_LINK_PROBLEMS } from "@/lib/auth/password-reset";

export const metadata = { title: "Choose a new password - Ciciro" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ token?: string }> };

// Where the password-reset email lands. Only looks the link up; the form's
// submit is what spends it, so a mail scanner opening the link changes nothing.
export default async function ResetPasswordPage({ searchParams }: Props) {
  const token = (await searchParams).token ?? "";
  const check = await checkEmailToken(token, "reset_password");
  if (!check.ok) {
    return (
      <AuthPanel title={check.problem === "used" ? "Link already used" : "This link won't work"}>
        <p className="auth-lede" role="alert">
          {RESET_LINK_PROBLEMS[check.problem]}
        </p>
        <Link className="btn primary" href="/forgot-password">
          Request a new link
        </Link>
        <p className="auth-alt">
          <Link href="/login">Back to sign in</Link>
        </p>
      </AuthPanel>
    );
  }
  return <ResetPasswordForm token={token} email={check.email} />;
}
