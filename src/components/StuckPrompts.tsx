"use client";

import { useState } from "react";
import type { StuckResponse } from "@/lib/recap-view";

type Props = {
  projectId: string;
  chapterId: string;
  // Hand the chosen prompt to the editor chat.
  onUse: (prompt: string) => void;
};

// "I'm stuck": a few concrete next steps from this chapter and the story bible.
export default function StuckPrompts({ projectId, chapterId, onUse }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/stuck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<StuckResponse> & {
        error?: string;
      };
      if (!res.ok || !data.prompts) throw new Error(data.error || "Could not get ideas.");
      setPrompts(data.prompts);
    } catch (e) {
      setPrompts([]);
      setError(e instanceof Error ? e.message : "Could not get ideas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="stuck">
      <button
        className="btn ghost small"
        onClick={() => (open && !busy ? setOpen(false) : void ask())}
        aria-expanded={open}
        title="Get a few ideas for what to write next"
      >
        I&apos;m stuck
      </button>
      {open && (
        <div className="stuck-pop" role="region" aria-label="Ideas for what to write next">
          {busy ? (
            <p className="stuck-note">Thinking of ways forward...</p>
          ) : error ? (
            <p className="stuck-note stuck-error">{error}</p>
          ) : (
            <ul>
              {prompts.map((prompt) => (
                <li key={prompt}>
                  <button
                    className="stuck-prompt"
                    onClick={() => {
                      setOpen(false);
                      onUse(prompt);
                    }}
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="stuck-foot">
            <button className="btn ghost small" onClick={() => void ask()} disabled={busy}>
              More ideas
            </button>
            <button className="btn ghost small" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
