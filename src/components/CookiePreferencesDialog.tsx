"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Presence from "@/components/Presence";
import { MOTION_MS } from "@/lib/motion";
import { CONSENT_CATEGORY_INFO, defaultConsentCategories, type ConsentCategories } from "@/lib/consent";
import { useConsent } from "@/components/ConsentProvider";

/**
 * The preference center: per-category toggles, reachable any time from
 * "Cookie settings" (footer, Settings) or from the banner's Customize. Always
 * mounted (see Providers.tsx); `open` controls visibility so it can be
 * triggered from anywhere without its own portal/instance per caller.
 */
export default function CookiePreferencesDialog() {
  const { categories, preferencesOpen, closePreferences, save } = useConsent();
  const [draft, setDraft] = useState<ConsentCategories>(categories);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(closePreferences);
  onCloseRef.current = closePreferences;

  useEffect(() => {
    if (!preferencesOpen) return;
    setDraft(categories);
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // Only re-seed the draft when the dialog opens, not on every categories change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferencesOpen]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <Presence open={preferencesOpen} exitMs={MOTION_MS.dialogOut}>
      <div className="drawer-overlay" onClick={closePreferences} />
      <div
        ref={dialogRef}
        className="account-dialog cookie-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-dialog-title"
        tabIndex={-1}
      >
        <h2 id="cookie-dialog-title">Cookie settings</h2>
        <p>
          Necessary cookies and your own saved preferences (theme, focus mode, and the like) are
          always on - they keep Ciciro working and never need your consent. Everything else is
          off until you turn it on.
        </p>
        <div className="cookie-dialog-categories">
          <div className="settings-row">
            <span>Necessary</span>
            <span className="cookie-dialog-locked">Always on</span>
          </div>
          <p className="settings-hint">Signing you in, keeping the site secure, and remembering this choice.</p>
          {CONSENT_CATEGORY_INFO.map((category) => (
            <div key={category.id}>
              <div className="settings-row">
                <span>{category.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft[category.id]}
                  className={`settings-switch ${draft[category.id] ? "on" : ""}`}
                  onClick={() => setDraft((d) => ({ ...d, [category.id]: !d[category.id] }))}
                >
                  {draft[category.id] ? "On" : "Off"}
                </button>
              </div>
              <p className="settings-hint">{category.description}</p>
            </div>
          ))}
        </div>
        <div className="account-dialog-actions">
          <button type="button" className="btn" onClick={() => save(defaultConsentCategories())}>
            Reject all
          </button>
          <button type="button" className="btn" onClick={() => save(draft)}>
            Save choices
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const all = Object.fromEntries(
                CONSENT_CATEGORY_INFO.map((c) => [c.id, true])
              ) as ConsentCategories;
              save(all);
            }}
          >
            Accept all
          </button>
        </div>
      </div>
    </Presence>,
    document.body
  );
}
