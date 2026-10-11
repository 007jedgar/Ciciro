"use client";

import { useEffect } from "react";
import DrawerHead from "@/components/DrawerHead";
import type { ManuscriptKind } from "@/lib/manuscript-kind";
import { SCREENPLAY_ELEMENT_LABELS } from "@/lib/screenplay";
import { screenplayShortcuts } from "@/lib/screenplay-view";
import { generalShortcuts, type ShortcutRow } from "@/lib/shortcuts";
import { isMacPlatform } from "@/lib/selection-menu-view";

type Props = {
  kind?: ManuscriptKind;
  hasChapters: boolean;
  onClose: () => void;
};

function Rows({ rows }: { rows: ShortcutRow[] }) {
  return (
    <dl>
      {rows.map((row) => (
        <div key={row.keys}>
          <dt>
            <kbd>{row.keys}</kbd>
          </dt>
          <dd>{row.label}</dd>
        </div>
      ))}
    </dl>
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

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer search-panel" role="dialog" aria-label="Keyboard shortcuts">
        <DrawerHead title="Keyboard shortcuts" onClose={onClose} />
        <Rows rows={generalShortcuts(mac, hasChapters)} />
        {kind === "screenplay" ? (
          <>
            <p className="scratch-hint">Screenplay elements</p>
            <Rows rows={screenplayShortcuts(mac, SCREENPLAY_ELEMENT_LABELS)} />
          </>
        ) : null}
      </div>
    </>
  );
}
