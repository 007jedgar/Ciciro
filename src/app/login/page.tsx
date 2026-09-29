import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import { socialAvailability } from "@/lib/auth/social-config";

export const metadata = { title: "Sign in - Ciciro" };
// The Apple / Google buttons follow runtime secrets, not the build's env.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const available = socialAvailability();
  return (
    <Suspense fallback={null}>
      <AuthForm mode="login" providers={{ apple: available.apple.web, google: available.google }} />
    </Suspense>
  );
}
