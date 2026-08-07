"use client";

import { useEffect, useState } from "react";
import type { OpenQuestion } from "@/lib/types";

type Props = {
  projectId: string;
  onClose: () => void;
  // Send the author's answer to the editor to reconcile the manuscript.
  onAnswer: (q: OpenQuestion, answer: string) => void;
};

export default function OpenQuestions({ projectId, onClose, onAnswer }: Props) {
  const [questions, setQuestions] = useState<OpenQuestion[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);

  async function load() {
    const res = await fetch(`/api/questions?projectId=${projectId}`);
    const data = await res.json();
    if (Array.isArray(data)) setQuestions(data);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function remove(id: string) {
    setQuestions((qs) => qs.filter((q) => q.id !== id));
    await fetch(`/api/questions/${id}`, { method: "DELETE" });
  }

  const open = questions.filter((q) => q.status === "open");
  const resolved = questions.filter((q) => q.status !== "open");

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" style={{ width: 500 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>Open questions</h2>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 0 }}>
          Forks the editor answered provisionally so it could keep writing. Answer one
          and it reconciles the manuscript - correcting the prose only if your answer
          differs from what it wrote.
        </p>

        {open.length === 0 && (
          <div className="empty">No open questions. The editor is not waiting on you.</div>
        )}

        {open.map((q) => (
          <div className="bible-item" key={q.id}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {q.question}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>
              Went with: <em>{q.provisional || "n/a"}</em>
              {q.affects ? ` · affects: ${q.affects}` : ""}
            </div>
            <textarea
              rows={2}
              placeholder="Your answer..."
              value={drafts[q.id] || ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                className="btn primary small"
                disabled={!(drafts[q.id] || "").trim()}
                onClick={() => onAnswer(q, (drafts[q.id] || "").trim())}
              >
                Answer &amp; reconcile
              </button>
              <button className="btn ghost small" onClick={() => remove(q.id)}>
                Dismiss
              </button>
            </div>
          </div>
        ))}

        {resolved.length > 0 && (
          <>
            <hr className="hr" />
            <button
              className="btn ghost small"
              onClick={() => setShowResolved((s) => !s)}
            >
              {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
            </button>
            {showResolved &&
              resolved.map((q) => (
                <div className="bible-item" key={q.id} style={{ opacity: 0.75 }}>
                  <div style={{ fontSize: 13 }}>{q.question}</div>
                  {q.answer && (
                    <div style={{ fontSize: 12, color: "var(--draft)" }}>
                      Answered: {q.answer}
                    </div>
                  )}
                  {q.resolution && (
                    <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                      {q.resolution}
                    </div>
                  )}
                </div>
              ))}
          </>
        )}
      </div>
    </>
  );
}
