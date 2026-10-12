"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildConsentRecord,
  defaultConsentCategories,
  honorsGlobalPrivacyControl,
  type ConsentCategories,
  type ConsentRecord,
} from "@/lib/consent";
import { readConsentCookie, writeConsentCookie } from "@/lib/consent-cookie";

type ConsentState = {
  /** The categories in effect right now: a stored decision's, or all-off before one exists. */
  categories: ConsentCategories;
  /** Whether a current-version decision exists for this device. */
  decided: boolean;
  /** The preference center (the "Customize" panel, reachable any time after the first decision too). */
  preferencesOpen: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
  acceptAll: () => void;
  rejectAll: () => void;
  save: (categories: ConsentCategories) => void;
};

const ConsentContext = createContext<ConsentState | null>(null);

export function ConsentProvider({
  initialRecord = null,
  children,
}: {
  /** The record read server-side from the request's cookie (layout.tsx), so SSR and the first client render agree - no banner flash on reload. */
  initialRecord?: ConsentRecord | null;
  children: ReactNode;
}) {
  const [record, setRecord] = useState<ConsentRecord | null>(initialRecord);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  // Reconcile with the cookie once mounted: a decision made in another tab,
  // or a cached shell the server rendered before a decision existed.
  useEffect(() => {
    const stored = readConsentCookie();
    setRecord((current) => (stored && !current ? stored : current));
  }, []);

  const decide = useCallback((categories: ConsentCategories) => {
    const next = buildConsentRecord(categories);
    writeConsentCookie(next);
    setRecord(next);
    setPreferencesOpen(false);
  }, []);

  const value = useMemo<ConsentState>(
    () => ({
      // No record yet: Global Privacy Control, when sent, is honored as
      // reject-all for analytics (it never overrides an explicit choice
      // once one exists, and the banner still shows regardless).
      categories: record?.categories ?? (honorsGlobalPrivacyControl() ? { analytics: false } : defaultConsentCategories()),
      decided: record !== null,
      preferencesOpen,
      openPreferences: () => setPreferencesOpen(true),
      closePreferences: () => setPreferencesOpen(false),
      acceptAll: () => decide({ analytics: true }),
      rejectAll: () => decide({ analytics: false }),
      save: decide,
    }),
    [record, preferencesOpen, decide]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentState {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within ConsentProvider");
  return ctx;
}
