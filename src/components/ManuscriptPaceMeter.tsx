"use client";

import { useEffect, useState } from "react";
import type { ManuscriptPace } from "@/lib/manuscript-target";
import { nanoPreset } from "@/lib/manuscript-target";

type TargetPayload = {
  wordGoal: number;
  deadline: string;
  manuscriptWords: number;
  pace: ManuscriptPace;
} | null;

export default function ManuscriptPaceMeter({ projectId }: { projectId: string }) {
  const [target, setTarget] = useState<TargetPayload>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/target`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { target?: TargetPayload };
        if (!cancelled) setTarget(body.target ?? null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function applyNano() {
    setBusy(true);
    try {
      const preset = nanoPreset();
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/target`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wordGoal: preset.wordGoal, deadline: preset.deadline }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { target?: TargetPayload };
      setTarget(body.target ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (!target) {
    return (
      <button
        type="button"
        className="manuscript-pace-link"
        disabled={busy}
        onClick={() => void applyNano()}
      >
        Set NaNo pace
      </button>
    );
  }

  const label = target.pace.complete
    ? "Manuscript goal met"
    : target.pace.pace == null
      ? `${target.pace.remaining.toLocaleString()} words left past deadline`
      : `${target.pace.pace.toLocaleString()} words today to finish by ${target.deadline}`;

  return <span className="manuscript-pace">{label}</span>;
}
