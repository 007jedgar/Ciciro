import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import { socialAvailability } from "@/lib/auth/social-config";

export const metadata = { title: "Create account - Ciciro" };
// The Apple / Google buttons follow runtime secrets, not the build's env.
export const dynamic = "force-dynamic";

export default function SignupPage() {
  const available = socialAvailability();
  return (
    <Suspense fallback={null}>
      <AuthForm mode="signup" providers={{ apple: available.apple.web, google: available.google }} />
    </Suspense>
  );
}
