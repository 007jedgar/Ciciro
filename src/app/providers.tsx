"use client";

import { SettingsProvider } from "@/components/SettingsProvider";
import SignInNotice from "@/components/SignInNotice";
import AiLimitDialog from "@/components/AiLimitDialog";
import { SnackbarProvider } from "@/components/Snackbar";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <SnackbarProvider>
        <SignInNotice />
        <AiLimitDialog />
        {children}
      </SnackbarProvider>
    </SettingsProvider>
  );
}
