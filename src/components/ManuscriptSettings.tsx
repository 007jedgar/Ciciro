"use client";

import BetaBadge from "@/components/BetaBadge";
import { hasKindSettings, type ManuscriptKind } from "@/lib/manuscript-kind";
import { SCREENPLAY_ELEMENT_LABELS } from "@/lib/screenplay";
import { screenplayShortcuts } from "@/lib/screenplay-view";
import { isMacPlatform } from "@/lib/selection-menu-view";

/**
 * Settings that belong to the manuscript that is open, for its kind, at the top
 * of the Settings menu. Nothing shows for a kind with none, or outside a
 * manuscript (the library).
 */
export default function ManuscriptSettings({ kind }: { kind?: ManuscriptKind }) {
  if (!kind || !hasKindSettings(kind)) return null;
  switch (kind) {
    case "screenplay":
      return <ScreenplaySettings />;
    default:
      return null;
  }
}

function ScreenplaySettings() {
  const mac = isMacPlatform(typeof navigator === "undefined" ? undefined : navigator.platform);
  return (
    <section className="kind-settings" aria-label="Screenplay settings">
      <div className="theme-menu-label">
        This screenplay <BetaBadge />
      </div>
      <div className="settings-row">
        <span>Script type</span>
        <span className="settings-locked" title="Locked for a script">
          12 pt Courier Prime
        </span>
      </div>
      <p className="settings-hint">
        Scripts are set in 12 pt Courier Prime on a 60 column page, so a page here is a page on paper. The Type and
        Size settings below do not apply to them.
      </p>
      <details className="settings-shortcuts">
        <summary>Element shortcuts</summary>
        <dl>
          {screenplayShortcuts(mac, SCREENPLAY_ELEMENT_LABELS).map((row) => (
            <div key={row.keys}>
              <dt>
                <kbd>{row.keys}</kbd>
              </dt>
              <dd>{row.label}</dd>
            </div>
          ))}
        </dl>
      </details>
      {/* Later: the (MORE) and (CONT'D) switches, scene numbers, and the title page live here. */}
    </section>
  );
}
