"use client";

import { useEffect } from "react";
import DrawerHead from "@/components/DrawerHead";
import type { ManuscriptKind } from "@/lib/manuscript-kind";
import { SCREENPLAY_ELEMENT_LABELS } from "@/lib/screenplay";
import { screenplayShortcuts } from "@/lib/screenplay-view";
import { generalShortcuts, keyCaps, type ShortcutRow } from "@/lib/shortcuts";
import { isMacPlatform } from "@/lib/selection-menu-view";

type Props = {
  kind?: ManuscriptKind;
  hasChapters: boolean;
  onClose: () => void;
};

type ShortcutSection = { heading: string; rows: ShortcutRow[] };

/** Rows, in their given order, bucketed under each row's `group` (or "General"). */
function sectionsOf(rows: ShortcutRow[]): ShortcutSection[] {
  const sections: ShortcutSection[] = [];
  for (const row of rows) {
    const heading = row.group ?? "General";
    const section = sections.find((s) => s.heading === heading);
    if (section) section.rows.push(row);
    else sections.push({ heading, rows: [row] });
  }
  return sections;
}

function Keys({ keys }: { keys: string }) {
  return (
    <span className="shortcut-keys">
      {keyCaps(keys).map((cap, i) => (
        <kbd key={i}>{cap}</kbd>
      ))}
    </span>
  );
}

function Section({ heading, rows }: ShortcutSection) {
  return (
    <section className="shortcuts-group">
      <h3>{heading}</h3>
      <table className="shortcuts-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="shortcuts-keys-cell">
                <Keys keys={row.keys} />
              </td>
              <td className="shortcuts-label-cell">{row.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The shortcuts reference, every manuscript's own and screenplay's element picks when one is open. */
export default function ShortcutsPanel({ kind, hasChapters, onClose }: Props) {
  const mac = isMacPlatform(typeof navigator === "undefined" ? undefined : navigator.platform);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sections = sectionsOf(generalShortcuts(mac, hasChapters));
  if (kind === "screenplay") {
    sections.push(...sectionsOf(screenplayShortcuts(mac, SCREENPLAY_ELEMENT_LABELS)));
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer shortcuts-panel" role="dialog" aria-label="Keyboard shortcuts">
        <DrawerHead title="Keyboard shortcuts" onClose={onClose} />
        {sections.map((section) => (
          <Section key={section.heading} heading={section.heading} rows={section.rows} />
        ))}
      </div>
    </>
  );
}
