"use client";

import { useEffect, useRef, useState } from "react";

export type MoreItem = {
  key: string;
  label: string;
  title?: string;
  // A count chip beside the label.
  count?: number;
  // A small dot beside the label (something is waiting).
  dot?: boolean;
  onSelect: () => void;
};

// Overflow menu for the top bar's less-used tools. A count or dot on an item
// also shows on the trigger, so nothing waiting for the writer is hidden.
export default function TopbarMore({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const waiting = items.some((i) => i.dot || (i.count ?? 0) > 0);

  return (
    <div className="more-menu-root" ref={rootRef}>
      <button
        type="button"
        className="btn small more-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        More
        {waiting && <span className="more-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label="More tools">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="more-item"
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {(item.count ?? 0) > 0 && <span className="count-chip">{item.count}</span>}
              {item.dot && <span className="more-dot" aria-label="Something is waiting" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
