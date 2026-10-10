/** A small pill that marks a feature as still in beta. */
export default function BetaBadge({
  className = "",
  title = "Screenplay formatting is in beta",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span className={`beta-badge ${className}`.trim()} title={title}>
      Beta
    </span>
  );
}
