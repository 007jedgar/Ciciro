"use client";

import { useId, useState } from "react";

/**
 * A small "i" bubble that explains one control in a sentence. Shown on
 * hover and keyboard focus (CSS, so it works even if JS state lags) and
 * toggled by a tap (state, since touch has no hover). A bare `title`
 * attribute is not enough on its own - it never reaches keyboard or touch
 * users - so this always pairs the bubble with `aria-describedby`.
 */
export default function InfoTip({ text, label = "What this does" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-tip-trigger"
        aria-label={label}
        aria-describedby={id}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      <span id={id} role="tooltip" className="info-tip-bubble" data-open={open ? "true" : undefined}>
        {text}
      </span>
    </span>
  );
}
