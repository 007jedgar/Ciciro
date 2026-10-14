import { Suspense } from "react";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export const metadata = { title: "Reset your password - Ciciro", robots: { index: false, follow: true } };

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
