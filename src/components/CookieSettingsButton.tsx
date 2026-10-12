"use client";

import type { ReactNode } from "react";
import { useConsent } from "@/components/ConsentProvider";

/**
 * The persistent "changing your mind must be as easy as giving consent"
 * entry point: opens the same preference center the banner's Customize
 * does. Used in the landing/features footers, the pricing and privacy
 * pages, and the web Settings menu - see docs/analytics.md's "Opt-in consent" bullet.
 */
export default function CookieSettingsButton({
  className = "auth-link-button",
  children = "Cookie settings",
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { openPreferences } = useConsent();
  return (
    <button type="button" className={className} onClick={openPreferences}>
      {children}
    </button>
  );
}
