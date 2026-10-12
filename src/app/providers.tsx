"use client";

import { SettingsProvider } from "@/components/SettingsProvider";
import SignInNotice from "@/components/SignInNotice";
import AiLimitDialog from "@/components/AiLimitDialog";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import { ConsentProvider } from "@/components/ConsentProvider";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import CookiePreferencesDialog from "@/components/CookiePreferencesDialog";
import { SnackbarProvider } from "@/components/Snackbar";
import type { ConsentRecord } from "@/lib/consent";
import type { ReactNode } from "react";

export function Providers({
  initialConsent,
  children,
}: {
  /** Read server-side from the ciciro_consent cookie (layout.tsx), so the banner never flashes on a reload where a decision already exists. */
  initialConsent: ConsentRecord | null;
  children: ReactNode;
}) {
  return (
    <ConsentProvider initialRecord={initialConsent}>
      <SettingsProvider>
        <AnalyticsProvider />
        <SnackbarProvider>
          <SignInNotice />
          <AiLimitDialog />
          {children}
        </SnackbarProvider>
      </SettingsProvider>
      <CookieConsentBanner />
      <CookiePreferencesDialog />
    </ConsentProvider>
  );
}
