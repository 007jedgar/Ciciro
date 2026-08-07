"use client";

type Props = {
  label?: string;
  size?: "sm" | "md";
};

/** Fountain pen sketching a line — used while waiting on the editor or auto-draft. */
export default function WritingLoader({ label = "Writing…", size = "md" }: Props) {
  return (
    <div className={`writing-loader ${size}`} role="status" aria-live="polite">
      <svg
        className="writing-loader-svg"
        viewBox="0 0 120 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        {/* paper grain hint */}
        <rect
          className="wl-paper"
          x="4"
          y="8"
          width="112"
          height="32"
          rx="4"
        />
        {/* ink trail */}
        <path
          className="wl-ink"
          d="M18 28 C 28 22, 36 34, 48 26 S 68 20, 78 28 S 96 34, 104 24"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* pencil / pen body */}
        <g className="wl-pen">
          <path
            className="wl-pen-body"
            d="M78 10 L102 4 L105 12 L82 20 Z"
          />
          <path
            className="wl-pen-band"
            d="M84 14.5 L98 10.5 L99 13.5 L85 17.5 Z"
          />
          <path
            className="wl-pen-tip"
            d="M78 10 L72 22 L82 20 Z"
          />
          {/* tip shine */}
          <circle className="wl-nib" cx="74.5" cy="19.5" r="1.2" />
        </g>
        {/* eraser dust / shavings */}
        <g className="wl-dust">
          <circle cx="52" cy="34" r="1.1" />
          <circle cx="60" cy="36" r="0.9" />
          <circle cx="68" cy="33" r="1.2" />
          <circle cx="76" cy="35" r="0.8" />
        </g>
      </svg>
      {label ? <span className="writing-loader-label">{label}</span> : null}
    </div>
  );
}
