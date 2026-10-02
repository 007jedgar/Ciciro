"use client";

import { SettingsProvider } from "@/components/SettingsProvider";
import SignInNotice from "@/components/SignInNotice";
import AiLimitDialog from "@/components/AiLimitDialog";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import { SnackbarProvider } from "@/components/Snackbar";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <AnalyticsProvider />
      <SnackbarProvider>
        <SignInNotice />
        <AiLimitDialog />
        {children}
      </SnackbarProvider>
    </SettingsProvider>
  );
}
