"use client";

import { useEffect, useState } from "react";
import { diffWords } from "diff";
import type { SnapshotDiffPart } from "@/lib/snapshot-view";

type Edit = { id: string; find: string; replace: string; createdAt: string };

type Props = {
  chapterId: string;
  // Bump this after a chat turn completes to refetch - new corrections may
  // have landed.
  refreshToken?: number;
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** Inline word diff: insertions highlighted, deletions struck through. */
export function WordDiff({ parts }: { parts: SnapshotDiffPart[] }) {
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "added" ? (
          <ins className="diff-add" key={i}>
            {part.text}
          </ins>
        ) : part.kind === "removed" ? (
          <del className="diff-del" key={i}>
            {part.text}
          </del>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

export default function DiffView({ chapterId, refreshToken }: Props) {
  const [edits, setEdits] = useState<Edit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEdits(null);
    fetch(`/api/chapters/${chapterId}/edits`)
      .then((r) => r.json())
      .then((data) => !cancelled && Array.isArray(data) && setEdits(data))
      .catch(() => !cancelled && setEdits([]));
    return () => {
      cancelled = true;
    };
  }, [chapterId, refreshToken]);

  if (edits === null) return <div className="diff-empty">Loading changes...</div>;
  if (edits.length === 0) {
    return (
      <div className="diff-empty">
        No AI corrections recorded yet for this chapter - they&apos;ll show up here as
        the editor makes them.
      </div>
    );
  }

  return (
    <div className="diff-view">
      {edits.map((e) => (
        <div className="diff-hunk" key={e.id}>
          <div className="diff-hunk-head">{relativeTime(e.createdAt)}</div>
          <div className="diff-hunk-body">
            <WordDiff
              parts={diffWords(e.find, e.replace).map((part) => ({
                kind: part.added ? "added" : part.removed ? "removed" : "same",
                text: part.value,
              }))}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
