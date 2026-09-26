"use client";

import { SettingsProvider } from "@/components/SettingsProvider";
import { SnackbarProvider } from "@/components/Snackbar";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <SnackbarProvider>{children}</SnackbarProvider>
    </SettingsProvider>
  );
}
