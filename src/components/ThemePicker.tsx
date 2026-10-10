"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES, webTheme, type ThemeId } from "@/lib/theme";
import { EDITOR_FONT_SIZES, FORMAT_CHROME, type FormatChrome } from "@/lib/settings";
import { useSettings } from "@/components/SettingsProvider";
import DeleteAccountDialog from "@/components/DeleteAccountDialog";
import { EXPORT_URL } from "@/lib/account/copy";
import type { ModelSummary } from "@/lib/models";
import { resendVerificationEmail } from "@/lib/verify-email-client";
import SettingsBilling from "@/components/SettingsBilling";
import SettingsEmailPreferences from "@/components/SettingsEmailPreferences";
import type { Entitlement } from "@/lib/billing-client";
import ManuscriptSettings from "@/components/ManuscriptSettings";
import { type ManuscriptKind } from "@/lib/manuscript-kind";

type Account = {
  email: string;
  hasPassword?: boolean;
  emailVerified?: boolean;
  entitlement: Entitlement | null;
};

export default function ThemePicker({
  compact = false,
  kind,
}: {
  compact?: boolean;
  /** The kind of the manuscript that is open, for its own settings at the top. Absent in the library. */
  kind?: ManuscriptKind;
}) {
  const { settings, patch } = useSettings();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelSummary | null>(null);
  // undefined until asked; null when signed out (local-first has no account).
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [verify, setVerify] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const rootRef = useRef<HTMLDivElement>(null);
  const theme = webTheme(settings.theme);

  useEffect(() => {
    if (!open || models) return;
    let cancelled = false;
    void fetch("/api/models")
      .then((res) => (res.ok ? (res.json() as Promise<ModelSummary>) : null))
      .then((data) => {
        if (!cancelled && data) setModels(data);
      })
      .catch(() => {
        /* no session yet, or offline - leave the section out */
      });
    return () => {
      cancelled = true;
    };
  }, [open, models]);

  // Re-read on every open: this month's AI use and the plan change underneath.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{
              user: { email: string; hasPassword?: boolean; emailVerified?: boolean } | null;
              entitlement?: Entitlement | null;
            }>)
          : null
      )
      .then((data) => {
        if (!cancelled) {
          setAccount(
            data?.user
              ? {
                  email: data.user.email,
                  hasPassword: data.user.hasPassword,
                  emailVerified: data.user.emailVerified,
                  entitlement: data.entitlement ?? null,
                }
              : null
          );
        }
      })
      .catch(() => {
        /* offline - leave the section out */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function resendVerification() {
    setVerify({ busy: true, note: null });
    const result = await resendVerificationEmail();
    if (result.ok && result.alreadyVerified) {
      setAccount((current) => (current ? { ...current, emailVerified: true } : current));
      setVerify({ busy: false, note: null });
      return;
    }
    setVerify({
      busy: false,
      note: result.ok ? `Sent. Check ${account?.email ?? "your inbox"} for the link.` : result.message,
    });
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Claim the key so focus mode, which listens on window, does not also exit.
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pickTheme(id: ThemeId) {
    patch({ theme: id });
  }

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const sizeIndex = EDITOR_FONT_SIZES.indexOf(settings.editorFontSize);
  // A script's type is fixed (see ManuscriptSettings), so these two do not apply to it.
  const typeLocked = kind === "screenplay";

  return (
    <div className={`theme-picker ${compact ? "compact" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="btn small theme-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Appearance and writing settings"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="theme-swatch"
          style={{
            background: `linear-gradient(135deg, ${current.swatch[0]} 55%, ${current.swatch[1]} 55%)`,
          }}
        />
        {!compact && <span>{current.label}</span>}
      </button>
      {open && (
        <div className="theme-menu" role="dialog" aria-label="App settings">
          <ManuscriptSettings kind={kind} />
          <div className="theme-menu-label">Light</div>
          <div className="theme-grid">
            {THEMES.filter((t) => t.mode === "light").map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === theme}
                className={`theme-option ${t.id === theme ? "active" : ""}`}
                onClick={() => pickTheme(t.id)}
              >
                <span
                  className="theme-swatch lg"
                  style={{
                    background: `linear-gradient(135deg, ${t.swatch[0]} 55%, ${t.swatch[1]} 55%)`,
                  }}
                />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="theme-menu-label">Dark</div>
          <div className="theme-grid">
            {THEMES.filter((t) => t.mode === "dark").map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === theme}
                className={`theme-option ${t.id === theme ? "active" : ""}`}
                onClick={() => pickTheme(t.id)}
              >
                <span
                  className="theme-swatch lg"
                  style={{
                    background: `linear-gradient(135deg, ${t.swatch[0]} 55%, ${t.swatch[1]} 55%)`,
                  }}
                />
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="theme-menu-label">Writing</div>
          <div className="settings-row">
            <span>Type</span>
            <div className={`settings-seg${typeLocked ? " locked" : ""}`} title={typeLocked ? "Locked for a script" : undefined}>
              <button
                type="button"
                className={settings.editorFont === "serif" ? "active" : ""}
                disabled={typeLocked}
                onClick={() => patch({ editorFont: "serif" })}
              >
                Serif
              </button>
              <button
                type="button"
                className={settings.editorFont === "sans" ? "active" : ""}
                disabled={typeLocked}
                onClick={() => patch({ editorFont: "sans" })}
              >
                Sans
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span>Size</span>
            <div className={`settings-seg${typeLocked ? " locked" : ""}`} title={typeLocked ? "Locked for a script" : undefined}>
              <button
                type="button"
                aria-label="Smaller type"
                disabled={typeLocked || sizeIndex <= 0}
                onClick={() =>
                  patch({ editorFontSize: EDITOR_FONT_SIZES[Math.max(0, sizeIndex - 1)] })
                }
              >
                A-
              </button>
              <span className="settings-size">{settings.editorFontSize}</span>
              <button
                type="button"
                aria-label="Larger type"
                disabled={typeLocked || sizeIndex >= EDITOR_FONT_SIZES.length - 1}
                onClick={() =>
                  patch({
                    editorFontSize:
                      EDITOR_FONT_SIZES[Math.min(EDITOR_FONT_SIZES.length - 1, sizeIndex + 1)],
                  })
                }
              >
                A+
              </button>
            </div>
          </div>
          <div className="settings-row settings-row-stack">
            <span>Formatting</span>
            <div className="settings-seg wrap">
              {FORMAT_CHROME.map((home) => (
                <button
                  key={home}
                  type="button"
                  className={settings.formatChrome === home ? "active" : ""}
                  onClick={() => patch({ formatChrome: home as FormatChrome })}
                >
                  {home === "smart"
                    ? "Smart"
                    : home === "selection"
                      ? "Highlight"
                      : home === "press"
                        ? "Press"
                        : "Always"}
                </button>
              ))}
            </div>
          </div>
          <p className="settings-hint">
            {settings.formatChrome === "smart"
              ? "Hides while you type. Highlight and long-press still work."
              : settings.formatChrome === "selection"
                ? "A bubble only when words are selected."
                : settings.formatChrome === "press"
                  ? "Long-press a paragraph for heading, quote, or list."
                  : "A keyboard bar that never leaves."}
          </p>
          <div className="settings-row">
            <span>Autocorrect</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoCorrect}
              className={`settings-switch ${settings.autoCorrect ? "on" : ""}`}
              onClick={() => patch({ autoCorrect: !settings.autoCorrect })}
            >
              {settings.autoCorrect ? "On" : "Off"}
            </button>
          </div>
          <div className="settings-row">
            <span>Reduce motion</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.reduceMotion}
              className={`settings-switch ${settings.reduceMotion ? "on" : ""}`}
              onClick={() => patch({ reduceMotion: !settings.reduceMotion })}
            >
              {settings.reduceMotion ? "On" : "Off"}
            </button>
          </div>
          <div className="settings-row">
            <span>Ciciro suggests edits</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.aiSuggestions}
              className={`settings-switch ${settings.aiSuggestions ? "on" : ""}`}
              onClick={() => patch({ aiSuggestions: !settings.aiSuggestions })}
            >
              {settings.aiSuggestions ? "On" : "Off"}
            </button>
          </div>
          <p className="settings-hint">
            {settings.aiSuggestions
              ? "Line edits arrive as tracked changes you accept or reject."
              : "Line edits change the prose directly."}
          </p>
          <div className="settings-row">
            <span>Experimental writing prompt</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.craftDefaults}
              className={`settings-switch ${settings.craftDefaults ? "on" : ""}`}
              onClick={() => patch({ craftDefaults: !settings.craftDefaults })}
            >
              {settings.craftDefaults ? "On" : "Off"}
            </button>
          </div>
          <p className="settings-hint">Ciciro drafts with rules against common AI writing habits, then checks each draft.</p>

          <div className="settings-row">
            <span>Share usage analytics</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.analyticsEnabled}
              className={`settings-switch ${settings.analyticsEnabled ? "on" : ""}`}
              onClick={() => patch({ analyticsEnabled: !settings.analyticsEnabled })}
            >
              {settings.analyticsEnabled ? "On" : "Off"}
            </button>
          </div>
          <p className="settings-hint">
            Helps us see which features are used and improve Ciciro. Never your manuscript text,
            chat content, or titles.
          </p>

          <div className="theme-menu-label">Daily words</div>
          <p className="settings-hint">
            Five minutes is a session. Aim for {settings.weeklyDayTarget} of the last 7 days. The
            rest are rest days, not a streak to protect.
          </p>
          <div className="settings-row">
            <span>Show meter</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showDailyGoal}
              className={`settings-switch ${settings.showDailyGoal ? "on" : ""}`}
              onClick={() => patch({ showDailyGoal: !settings.showDailyGoal })}
            >
              {settings.showDailyGoal ? "On" : "Off"}
            </button>
          </div>
          {settings.showDailyGoal ? (
            <>
              <div className="settings-row">
                <span>Goal</span>
                <div className="settings-seg">
                  {([100, 250, 500] as const).map((goal) => (
                    <button
                      key={goal}
                      type="button"
                      className={settings.dailyWordGoal === goal ? "active" : ""}
                      onClick={() => patch({ dailyWordGoal: goal })}
                    >
                      {goal}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <span>Days / week</span>
                <div className="settings-seg">
                  {([3, 4, 5, 6, 7] as const).map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={settings.weeklyDayTarget === days ? "active" : ""}
                      onClick={() => patch({ weeklyDayTarget: days })}
                    >
                      {days}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {models ? (
            <>
              <div className="theme-menu-label">Models</div>
              {models.slots.map((slot) => (
                <div className="settings-row" key={slot.role}>
                  <span>{slot.role}</span>
                  <span className="settings-model" title={slot.id}>
                    {slot.name}
                  </span>
                </div>
              ))}
              {models.router ? (
                <div className="settings-row">
                  <span>Router</span>
                  <span className="settings-model" title={models.router.id}>
                    {models.router.name} (Groq)
                  </span>
                </div>
              ) : null}
            </>
          ) : null}

          {account?.entitlement ? <SettingsBilling entitlement={account.entitlement} /> : null}

          {account ? <SettingsEmailPreferences /> : null}

          {account ? (
            <>
              <div className="theme-menu-label">Account</div>
              <p className="settings-hint settings-account" title={account.email}>
                {account.email}
              </p>
              {account.emailVerified === false ? (
                <>
                  <p className="settings-hint settings-unverified" role={verify.note ? "status" : undefined}>
                    {verify.note ?? "Email not confirmed yet."}
                  </p>
                  <button
                    type="button"
                    className="settings-action"
                    onClick={() => void resendVerification()}
                    disabled={verify.busy}
                  >
                    {verify.busy ? "Sending…" : "Resend confirmation email"}
                  </button>
                </>
              ) : null}
              <a className="settings-action" href={EXPORT_URL} download>
                Export my data
              </a>
              <button
                type="button"
                className="settings-action danger"
                onClick={() => {
                  setOpen(false);
                  setDeleting(true);
                }}
              >
                Delete account…
              </button>
            </>
          ) : null}
        </div>
      )}
      {account ? (
        <DeleteAccountDialog
          open={deleting}
          email={account.email}
          // Absent from an older server: treat as a password account.
          hasPassword={account.hasPassword !== false}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </div>
  );
}
