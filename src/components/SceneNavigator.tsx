"use client";

import { useEffect, useMemo } from "react";
import BetaBadge from "@/components/BetaBadge";
import DrawerHead from "@/components/DrawerHead";
import { sceneOutline, scriptBlocksCached, type PageCursor, type SceneOutline } from "@/lib/screenplay";

type Sequence = { id: string; title: string; content: string };

type Props = {
  sequences: Sequence[];
  /** Where each sequence starts on the page, in the same order. */
  starts: PageCursor[];
  activeId: string | null;
  onJump: (sequenceId: string, scene: number) => void;
  /** Move scene `from` to where scene `to` is, in the open sequence. */
  onMove: (from: number, to: number) => void;
  onClose: () => void;
};

type Row = SceneOutline & { scene: number };

/**
 * The scenes of a script, in order: each with its heading and the page it begins
 * on. Choose one to go there; in the open sequence a scene can be moved up or
 * down, which takes its action and dialogue with it. Derived from the blocks on
 * every render, so it follows the page as it is typed.
 */
export default function SceneNavigator({ sequences, starts, activeId, onJump, onMove, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(
    () =>
      sequences.map((sequence, i) => {
        const outline = sceneOutline(scriptBlocksCached(sequence.content), starts[i]);
        const rows: Row[] = outline.map((row, scene) => ({ ...row, scene }));
        // A lead-in with nothing in it is not a scene to list.
        const blocks = scriptBlocksCached(sequence.content);
        return {
          sequence,
          rows: rows.filter((row) => row.heading !== null || blocks.slice(row.start, row.end).some((b) => b.text.trim() !== "")),
        };
      }),
    [sequences, starts]
  );
  const total = groups.reduce((n, g) => n + g.rows.filter((r) => r.heading !== null).length, 0);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer scene-navigator" role="dialog" aria-label="Scenes">
        <DrawerHead
          title={
            <>
              Scenes <BetaBadge />
            </>
          }
          onClose={onClose}
        />
        <p className="scratch-hint">
          Every scene heading in the script, with the page it begins on. Choose one to go there. In the open
          sequence, move a scene up or down and its action and dialogue go with it.
        </p>
        <div className="search-summary" aria-live="polite">
          {total === 0 ? "No scenes yet" : `${total} ${total === 1 ? "scene" : "scenes"}`}
        </div>
        <div className="search-results">
          {total === 0 ? (
            <div className="empty">Start a line with INT. or EXT. and it will show up here.</div>
          ) : null}
          {groups.map(({ sequence, rows }) => {
            if (rows.length === 0) return null;
            const open = sequence.id === activeId;
            const headed = rows.filter((r) => r.heading !== null);
            return (
              <div className="search-group" key={sequence.id}>
                <div className="search-group-title">{sequence.title || "Untitled sequence"}</div>
                {rows.map((row) => {
                  const position = headed.indexOf(row);
                  const before = headed[position - 1];
                  const after = headed[position + 1];
                  return (
                    <div className="scene-row" key={row.scene}>
                      <button
                        type="button"
                        className="scene-row-main"
                        onClick={() => onJump(sequence.id, row.scene)}
                        title="Go to this scene"
                      >
                        <span className="scene-row-number">{row.heading === null ? "" : position + 1}</span>
                        <span className={`scene-row-title${row.heading === null || row.title === "" ? " is-muted" : ""}`}>
                          {row.heading === null ? "Before the first scene" : row.title || "Untitled scene"}
                        </span>
                        <span className="scene-row-page">p. {row.page}</span>
                      </button>
                      {open && row.heading !== null ? (
                        <span className="scene-row-moves">
                          <button
                            type="button"
                            className="btn ghost icon-btn"
                            aria-label={`Move ${row.title || "scene"} up`}
                            title="Move up"
                            disabled={!before}
                            onClick={() => before && onMove(row.scene, before.scene)}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                              <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="btn ghost icon-btn"
                            aria-label={`Move ${row.title || "scene"} down`}
                            title="Move down"
                            disabled={!after}
                            onClick={() => after && onMove(row.scene, after.scene)}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            </svg>
                          </button>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
