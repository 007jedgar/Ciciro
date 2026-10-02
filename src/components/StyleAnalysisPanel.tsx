"use client";

import { useState } from "react";
import DrawerHead from "@/components/DrawerHead";
import {
  runStyleAnalysis,
  saveBibleFile,
  type CharacterVoiceProposal,
  type StyleAnalysisProposal,
  type StyleTrait,
} from "@/lib/style-analysis-client";
import { replaceVoiceSection, STYLE_TRAIT_LABELS } from "@/lib/style-analysis-view";
import { getAnalytics } from "@/lib/analytics-client";

type Props = {
  projectId: string;
  onClose: () => void;
};

type ItemState = "idle" | "saving" | "saved" | "error";

const quoteStyle: React.CSSProperties = {
  fontSize: 12,
  fontStyle: "italic",
  color: "var(--ink-soft)",
  margin: "2px 0 6px",
};

function TraitRow({ trait }: { trait: StyleTrait }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <strong style={{ fontSize: 12 }}>{STYLE_TRAIT_LABELS[trait.category]}:</strong>{" "}
      <span style={{ fontSize: 12 }}>{trait.text}</span>
      {trait.quote && <div style={quoteStyle}>&quot;{trait.quote}&quot;</div>}
    </div>
  );
}

// Reads a sample of the author's own chapters and drafts a proposed style.md
// plus character Voice sections, each backed by a quote from their own prose
// - Ciciro's answer to Sudowrite's "My Voice." Nothing here writes to the
// bible on its own: every field is editable, and each save goes through the
// same POST /api/bible the Story Bible drawer uses, one file at a time.
export default function StyleAnalysisPanel({ projectId, onClose }: Props) {
  const [proposal, setProposal] = useState<StyleAnalysisProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [styleDraft, setStyleDraft] = useState("");
  const [styleState, setStyleState] = useState<ItemState>("idle");
  const [styleRevision, setStyleRevision] = useState(0);
  const [charDrafts, setCharDrafts] = useState<Record<string, string>>({});
  const [charState, setCharState] = useState<Record<string, ItemState>>({});
  const [charRevisions, setCharRevisions] = useState<Record<string, number>>({});

  async function analyze() {
    setLoading(true);
    setError("");
    try {
      const found = await runStyleAnalysis(projectId);
      setProposal(found);
      getAnalytics().track("style_analysis_viewed", {});
      setStyleDraft(found.proposedStyleMd);
      setStyleState("idle");
      setStyleRevision(found.currentStyleMdRevision);
      const drafts: Record<string, string> = {};
      const revisions: Record<string, number> = {};
      for (const c of found.characters) {
        drafts[c.path] = replaceVoiceSection(c.currentContent, c.voice);
        revisions[c.path] = c.currentRevision;
      }
      setCharDrafts(drafts);
      setCharRevisions(revisions);
      setCharState({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveStyle() {
    if (!proposal) return;
    setStyleState("saving");
    setError("");
    try {
      const { revision } = await saveBibleFile(projectId, "style.md", styleDraft, styleRevision);
      setStyleRevision(revision);
      setStyleState("saved");
    } catch (e) {
      setError((e as Error).message);
      setStyleState("error");
    }
  }

  async function saveCharacter(c: CharacterVoiceProposal) {
    setCharState((s) => ({ ...s, [c.path]: "saving" }));
    setError("");
    try {
      const { revision } = await saveBibleFile(
        projectId,
        c.path,
        charDrafts[c.path] ?? "",
        charRevisions[c.path] ?? c.currentRevision
      );
      setCharRevisions((r) => ({ ...r, [c.path]: revision }));
      setCharState((s) => ({ ...s, [c.path]: "saved" }));
    } catch (e) {
      setError((e as Error).message);
      setCharState((s) => ({ ...s, [c.path]: "error" }));
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="Analyze my style">
        <DrawerHead title="Analyze my style" onClose={onClose} />
        <p className="scratch-hint">
          Samples your own chapters and drafts a proposed style.md and a Voice section for
          characters who speak enough to show one, each backed by a real quote from your prose.
          Nothing is written to the bible until you save a piece of it below - edit anything first.
        </p>

        {error && (
          <div className="scratch-error" role="alert">
            {error}
          </div>
        )}

        {!proposal && (
          <button className="btn primary" onClick={analyze} disabled={loading}>
            {loading ? "Analyzing…" : "Analyze my style"}
          </button>
        )}

        {proposal && (
          <>
            <button className="btn ghost small" onClick={analyze} disabled={loading}>
              {loading ? "Re-analyzing…" : "Re-analyze"}
            </button>

            {proposal.sampledChapters.length > 0 && (
              <p className="scratch-hint">
                Sampled from: {proposal.sampledChapters.map((c) => c.title || "Untitled").join(", ")}
              </p>
            )}

            <hr className="hr" />

            <div className="bible-item">
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Proposed style.md</div>
              {proposal.draftTraits.map((t) => (
                <TraitRow key={t.category} trait={t} />
              ))}
              {proposal.draftTraits.length === 0 && (
                <p className="scratch-hint">
                  Your style.md already covers everything the analysis found; nothing new to add.
                </p>
              )}
              {proposal.currentStyleMd.trim() && (
                <details style={{ margin: "6px 0" }}>
                  <summary style={{ fontSize: 12, cursor: "pointer" }}>
                    Your current style.md (kept as is; only new categories are added below it)
                    {proposal.styleSuggestions.length > 0 &&
                      ` - ${proposal.styleSuggestions.length} differing ${
                        proposal.styleSuggestions.length === 1 ? "reading" : "readings"
                      } to compare`}
                  </summary>
                  <pre
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      color: "var(--ink-soft)",
                      margin: "6px 0 0",
                    }}
                  >
                    {proposal.currentStyleMd}
                  </pre>
                  {proposal.styleSuggestions.length > 0 && (
                    <div className="style-suggestions" style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                        Suggestions only - not added to the draft
                      </div>
                      {proposal.styleSuggestions.map((sg) => (
                        <div key={sg.trait.category} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                            You have: {sg.current}
                          </div>
                          <TraitRow trait={sg.trait} />
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              )}
              <textarea
                value={styleDraft}
                onChange={(e) => {
                  setStyleDraft(e.target.value);
                  setStyleState("idle");
                }}
                rows={12}
                style={{ fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.6 }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  className="btn primary small"
                  onClick={saveStyle}
                  disabled={styleState === "saving" || styleState === "saved"}
                >
                  {styleState === "saved"
                    ? "Saved to style.md"
                    : styleState === "saving"
                      ? "Saving…"
                      : "Save to style.md"}
                </button>
              </div>
            </div>

            {proposal.characters.map((c) => (
              <div className="bible-item" key={c.path}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{c.name} - Voice</div>
                <div style={{ fontSize: 12, marginBottom: 4 }}>{c.voice}</div>
                {c.quote && <div style={quoteStyle}>&quot;{c.quote}&quot;</div>}
                <textarea
                  value={charDrafts[c.path] ?? ""}
                  onChange={(e) => {
                    setCharDrafts((d) => ({ ...d, [c.path]: e.target.value }));
                    setCharState((s) => ({ ...s, [c.path]: "idle" }));
                  }}
                  rows={10}
                  style={{ fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.6 }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button
                    className="btn primary small"
                    onClick={() => saveCharacter(c)}
                    disabled={charState[c.path] === "saving" || charState[c.path] === "saved"}
                  >
                    {charState[c.path] === "saved"
                      ? `Saved to ${c.name}`
                      : charState[c.path] === "saving"
                        ? "Saving…"
                        : `Save to ${c.name}`}
                  </button>
                </div>
              </div>
            ))}

            {proposal.characters.length === 0 && (
              <p className="scratch-hint">
                No character had enough sampled dialogue for a Voice section this time.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
