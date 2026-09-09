"use client";

import { SettingsProvider } from "@/components/SettingsProvider";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}
