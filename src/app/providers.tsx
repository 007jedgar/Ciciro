"use client";

import { SettingsProvider } from "@/components/SettingsProvider";
import SignInNotice from "@/components/SignInNotice";
import { SnackbarProvider } from "@/components/Snackbar";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <SnackbarProvider>
        <SignInNotice />
        {children}
      </SnackbarProvider>
    </SettingsProvider>
  );
}
