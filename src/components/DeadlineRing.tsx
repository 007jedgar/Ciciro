"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Words written over the word target, 0 to 1. */
  progress: number;
  /** The target is met: the ring is closed and a tick is drawn in it. */
  complete: boolean;
  size: number;
  strokeWidth: number;
};

// Words written over the word target as a ring that fills and, at the target,
// closes with a tick drawn inside it. Its middle is the percent while there is
// more to write. The fill and the tick run on CSS transitions (--duration-ring),
// so reduced motion shows the ring as it stands.
export default function DeadlineRing({ progress, complete, size, strokeWidth }: Props) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(progress));
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.floor(progress * 100);
  const label = complete ? "Word target reached" : `${percent} percent of the word target written`;
  const tick = size * 0.4;
  const mid = size / 2;

  return (
    <svg
      className="deadline-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      data-progress={progress.toFixed(3)}
      data-complete={complete}
    >
      <circle cx={mid} cy={mid} r={radius} className="deadline-ring-track" strokeWidth={strokeWidth} fill="none" />
      <circle
        cx={mid}
        cy={mid}
        r={radius}
        className="deadline-ring-fill"
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - shown)}
        transform={`rotate(-90 ${mid} ${mid})`}
      />
      {complete ? (
        <path
          className="deadline-ring-tick"
          d={`M ${mid - tick * 0.5} ${mid + tick * 0.02} L ${mid - tick * 0.12} ${mid + tick * 0.4} L ${mid + tick * 0.52} ${mid - tick * 0.34}`}
          pathLength={1}
          strokeWidth={Math.max(2, size * 0.04)}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={1}
          strokeDashoffset={shown >= 1 ? 0 : 1}
        />
      ) : (
        <text
          className="deadline-ring-percent"
          x={mid}
          y={mid}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.round(size * 0.24)}
          aria-hidden="true"
        >
          {`${percent}%`}
        </text>
      )}
    </svg>
  );
}
