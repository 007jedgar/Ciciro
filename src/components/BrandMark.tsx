/** Ellipsis mark. Warm (terracotta on mist) for light themes; ink for dark. */
export default function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="brand-mark-img brand-mark-light"
        src="/brand/mark-warm.png"
        alt=""
        width={size}
        height={size}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="brand-mark-img brand-mark-dark"
        src="/brand/mark-ink.png"
        alt=""
        width={size}
        height={size}
      />
    </span>
  );
}
