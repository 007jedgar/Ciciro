/**
 * The ellipsis mark as a seal: three vermilion dots inside an ink ring. The
 * ring takes the surrounding text colour, so one mark works on the desk, on a
 * sheet and on the ink band, in every theme.
 */
export default function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 48 48" width={size} height={size} focusable="false">
        <circle cx="24" cy="24" r="22.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="14.5" cy="24" r="3.6" fill="var(--vermilion)" />
        <circle cx="24" cy="24" r="3.6" fill="var(--vermilion)" />
        <circle cx="33.5" cy="24" r="3.6" fill="var(--vermilion)" />
      </svg>
    </span>
  );
}
