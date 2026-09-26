"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { Chapter } from "@/lib/types";
import { boxIndexAt, chapterBlurb, moveItem } from "@/lib/outline";
import { chapterPlainText } from "@/lib/text";
import { MOTION_MS, motionMs } from "@/lib/motion";

type Props = {
  chapters: Chapter[];
  activeId: string | null;
  onOpen: (id: string) => void;
  /** New full order of chapter ids after a drag or a keyboard move. */
  onReorder: (ids: string[]) => void;
  onStatusChange: (id: string, status: string) => void;
  onClose: () => void;
};

type Layout = "board" | "list";

// A card being carried. It floats at the pointer (position: fixed) while a
// dashed placeholder holds its place in the grid, so the others can shift
// around the gap.
type Drag = {
  id: string;
  from: number;
  /** Where the placeholder sits among the other cards. */
  over: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const DRAG_THRESHOLD = 4;
const SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)";

export default function OutlineBoard({
  chapters,
  activeId,
  onOpen,
  onReorder,
  onStatusChange,
  onClose,
}: Props) {
  const [layout, setLayout] = useState<Layout>("board");
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const placeholderRef = useRef<HTMLDivElement>(null);
  const lastPositions = useRef(new Map<string, { x: number; y: number }>());
  const justDragged = useRef(false);
  // The drop animation holds the card in place until React has put it back in the grid.
  const settling = useRef<Animation | null>(null);
  const ids = chapters.map((c) => c.id);

  function move(id: string, to: number) {
    const from = ids.indexOf(id);
    if (from < 0 || to === from || to < 0 || to >= ids.length) return;
    onReorder(moveItem(ids, from, to));
  }

  // Neighbours glide to their new places instead of jumping (FLIP): note where
  // every card was, and after the layout changes play the difference back.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (!drag && settling.current) {
      settling.current.cancel();
      settling.current = null;
    }
    const next = new Map<string, { x: number; y: number }>();
    for (const [id, el] of cardEls.current) {
      if (!el.isConnected || el.dataset.floating === "true") continue;
      next.set(id, { x: el.offsetLeft, y: el.offsetTop });
    }
    const wait = motionMs(MOTION_MS.reorder);
    if (wait > 0 && typeof Element.prototype.animate === "function") {
      for (const [id, at] of next) {
        const was = lastPositions.current.get(id);
        if (!was || (was.x === at.x && was.y === at.y)) continue;
        cardEls.current.get(id)?.animate(
          [{ transform: `translate(${was.x - at.x}px, ${was.y - at.y}px)` }, { transform: "none" }],
          { duration: wait, easing: SPRING }
        );
      }
    }
    lastPositions.current = next;
  });

  function beginPointer(e: React.PointerEvent<HTMLDivElement>, id: string) {
    // Touch scrolls the panel; the arrows move cards there. Controls keep their clicks.
    if (e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest(".outline-move, select")) return;
    const card = e.currentTarget;
    const box = card.getBoundingClientRect();
    const grabX = e.clientX - box.left;
    const grabY = e.clientY - box.top;
    const startX = e.clientX;
    const startY = e.clientY;
    const from = ids.indexOf(id);
    let started = false;

    // Hit-test the cards where the layout puts them, not where they are drawn:
    // a neighbour mid-glide is transformed, and following it would make the gap
    // chase the pointer.
    const overAt = (clientX: number, clientY: number, current: number) => {
      const grid = gridRef.current;
      if (!grid) return current;
      const origin = grid.getBoundingClientRect();
      const laidOut = (el: HTMLElement | null | undefined) =>
        el
          ? {
              left: el.offsetLeft,
              top: el.offsetTop,
              right: el.offsetLeft + el.offsetWidth,
              bottom: el.offsetTop + el.offsetHeight,
            }
          : { left: 1, top: 1, right: 0, bottom: 0 };
      const all = ids.filter((other) => other !== id).map((other) => laidOut(cardEls.current.get(other)));
      // The gap counts as a card so the pointer over it changes nothing.
      if (placeholderRef.current) all.splice(current, 0, laidOut(placeholderRef.current));
      const hit = boxIndexAt(all, clientX - origin.left, clientY - origin.top);
      return hit < 0 ? current : hit;
    };

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        justDragged.current = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const prev = dragRef.current;
      const next: Drag = {
        id,
        from,
        over: prev ? overAt(ev.clientX, ev.clientY, prev.over) : from,
        x: ev.clientX - grabX,
        y: ev.clientY - grabY,
        w: box.width,
        h: box.height,
      };
      dragRef.current = next;
      setDrag(next);
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (!started) return;
      // Swallow the click that follows a drag so it cannot open the chapter.
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      const current = dragRef.current;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        dragRef.current = null;
        setDrag(null);
        if (commit && current) move(id, current.over);
      };
      const el = cardEls.current.get(id);
      const gap = placeholderRef.current?.getBoundingClientRect();
      const wait = motionMs(MOTION_MS.drop);
      if (!current || !el || !gap || wait === 0 || typeof el.animate !== "function") return settle();
      // The card drops into the gap, easing down from its lifted size.
      const at = el.getBoundingClientRect();
      const target = commit ? gap : new DOMRect(box.left, box.top, box.width, box.height);
      const animation = el.animate(
        [
          { transform: "scale(1.03)" },
          { transform: `translate(${target.left - at.left}px, ${target.top - at.top}px) scale(1)` },
        ],
        { duration: wait, easing: SPRING, fill: "forwards" }
      );
      settling.current = animation;
      animation.onfinish = settle;
      animation.oncancel = settle;
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  // Cards in DOM order. The carried card keeps its own slot (it is out of flow),
  // and the placeholder is threaded in among the rest.
  const others = drag ? chapters.filter((c) => c.id !== drag.id) : [];
  const beforePlaceholder = drag ? others[drag.over]?.id ?? null : null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="outline-panel" role="dialog" aria-label="Chapter outline">
        <div className="outline-head">
          <h2>Outline</h2>
          <span className="outline-hint">Drag a chapter to reorder, or use the arrows.</span>
          <span style={{ flex: 1 }} />
          <div className="view-toggle">
            <button
              className={`btn small ${layout === "board" ? "primary" : "ghost"}`}
              onClick={() => setLayout("board")}
            >
              Corkboard
            </button>
            <button
              className={`btn small ${layout === "list" ? "primary" : "ghost"}`}
              onClick={() => setLayout("list")}
            >
              List
            </button>
          </div>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        {chapters.length === 0 ? (
          <div className="empty">No chapters yet.</div>
        ) : (
          <div className={`outline-grid ${layout}`} ref={gridRef}>
            {chapters.map((ch, i) => {
              const floating = drag?.id === ch.id;
              return (
                <Fragment key={ch.id}>
                  {drag && beforePlaceholder === ch.id ? (
                    <div
                      className="outline-card placeholder"
                      ref={placeholderRef}
                      style={{ height: drag.h }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <div
                    ref={(el) => {
                      if (el) cardEls.current.set(ch.id, el);
                      else cardEls.current.delete(ch.id);
                    }}
                    className={`outline-card${ch.id === activeId ? " active" : ""}${
                      floating ? " dragging" : ""
                    }`}
                    data-testid="outline-card"
                    data-floating={floating ? "true" : undefined}
                    style={
                      floating && drag
                        ? { left: drag.x, top: drag.y, width: drag.w, height: drag.h }
                        : undefined
                    }
                    onPointerDown={(e) => beginPointer(e, ch.id)}
                    onClickCapture={(e) => {
                      if (justDragged.current) {
                        e.stopPropagation();
                        e.preventDefault();
                      }
                    }}
                  >
                    <div className="outline-card-top">
                      <span className="outline-num">{i + 1}</span>
                      <button
                        className="outline-title"
                        onClick={() => {
                          onOpen(ch.id);
                          onClose();
                        }}
                        title="Open this chapter"
                      >
                        {ch.title || "Untitled"}
                      </button>
                      <span className="outline-move">
                        <button
                          className="btn ghost small"
                          aria-label={`Move ${ch.title || "Untitled"} earlier`}
                          disabled={i === 0}
                          onClick={() => move(ch.id, i - 1)}
                        >
                          &uarr;
                        </button>
                        <button
                          className="btn ghost small"
                          aria-label={`Move ${ch.title || "Untitled"} later`}
                          disabled={i === chapters.length - 1}
                          onClick={() => move(ch.id, i + 1)}
                        >
                          &darr;
                        </button>
                      </span>
                    </div>
                    <p className="outline-blurb">
                      {chapterBlurb(ch.summary, chapterPlainText(ch.content)) || (
                        <em>Nothing written yet.</em>
                      )}
                    </p>
                    <div className="outline-meta">
                      <span>{ch.wordCount.toLocaleString()} words</span>
                      <select
                        value={ch.status}
                        aria-label={`Status of ${ch.title || "Untitled"}`}
                        onChange={(e) => onStatusChange(ch.id, e.target.value)}
                        style={{ width: "auto", padding: "2px 6px" }}
                      >
                        <option value="draft">draft</option>
                        <option value="revised">revised</option>
                        <option value="final">final</option>
                      </select>
                    </div>
                  </div>
                </Fragment>
              );
            })}
            {drag && beforePlaceholder === null ? (
              <div
                className="outline-card placeholder"
                ref={placeholderRef}
                style={{ height: drag.h }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
