"use client";

import { useEffect, useState } from "react";
import { shouldShowRecap, type Recap, type RecapResponse } from "@/lib/recap-view";

function lastOpenedKey(projectId: string) {
  return `ciciro:last-opened:${projectId}`;
}

// Read the last time this manuscript was opened here, then stamp now. Storage
// can be blocked; without it the recap simply never shows.
function touchLastOpened(projectId: string): number | null {
  try {
    const raw = window.localStorage.getItem(lastOpenedKey(projectId));
    window.localStorage.setItem(lastOpenedKey(projectId), String(Date.now()));
    const last = raw ? Number(raw) : NaN;
    return Number.isFinite(last) ? last : null;
  } catch {
    return null;
  }
}

// A short "Previously on" card for an author coming back after time away. The
// server caches the text, so re-opening without new writing costs nothing.
export default function PreviouslyOn({ projectId }: { projectId: string }) {
  const [recap, setRecap] = useState<Recap | null>(null);

  useEffect(() => {
    const lastOpened = touchLastOpened(projectId);
    if (!shouldShowRecap(lastOpened, Date.now())) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/recap`)
      .then((res) => (res.ok ? (res.json() as Promise<RecapResponse>) : null))
      .then((data) => {
        if (!cancelled && data?.recap) setRecap(data.recap);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!recap) return null;
  return (
    <aside className="previously-on" aria-label="Previously on">
      <div className="previously-on-head">
        <strong>Previously on</strong>
        <button
          className="btn ghost small"
          onClick={() => setRecap(null)}
          aria-label="Dismiss recap"
        >
          Dismiss
        </button>
      </div>
      <p>{recap.text}</p>
    </aside>
  );
}
