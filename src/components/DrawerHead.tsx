import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}

// The one header every right-hand drawer uses: title left, a 32px icon Close
// right, both centred on the same line.
export default function DrawerHead({ title, onClose, closeDisabled }: Props) {
  return (
    <div className="drawer-head">
      <h2>{title}</h2>
      <button
        type="button"
        className="btn ghost icon-btn"
        aria-label="Close"
        title="Close"
        onClick={onClose}
        disabled={closeDisabled}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M2 2l10 10M12 2L2 12"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}
