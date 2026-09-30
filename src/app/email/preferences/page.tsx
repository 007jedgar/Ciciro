import { Suspense } from "react";
import EmailPreferencesForm from "@/components/EmailPreferencesForm";

export const metadata = { title: "Email preferences - Ciciro" };

export default function EmailPreferencesPage() {
  return (
    <Suspense fallback={null}>
      <EmailPreferencesForm />
    </Suspense>
  );
}
