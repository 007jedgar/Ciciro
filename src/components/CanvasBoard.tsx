"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { reportAiLimit } from "@/lib/billing-client";
import { getAnalytics } from "@/lib/analytics-client";
import {
  CANVAS_CARD_WIDTH,
  CANVAS_LABEL_COLORS,
  curveBetween,
  type CanvasLabelColor,
  type OutlineNode,
} from "@/lib/canvas-view";

type Label = { id: string; name: string; color: CanvasLabelColor };
type Card = { id: string; title: string; body: string; x: number; y: number; labelIds: string[] };
type Edge = { id: string; fromId: string; toId: string };
type View = { x: number; y: number; scale: number };
type Step = { undo: () => Promise<void>; redo: () => Promise<void> };
type Preview =
  | { mode: "fill"; cardId: string; body: string; previous: string }
  | { mode: "options"; cardId: string; options: string[]; previous: string }
  | { mode: "outline"; cardId: string; raw: string; nodes: OutlineNode[] };

type Props = { projectId: string; onClose: () => void };

function errorOf(data: unknown, fallback: string): string {
  const message = (data as { error?: unknown } | null)?.error;
  return typeof message === "string" ? message : fallback;
}

function OutlineTree({ nodes }: { nodes: OutlineNode[] }) {
  return (
    <ul className="canvas-outline-list">
      {nodes.map((node, index) => (
        <li key={`${node.title}-${index}`}>
          <strong>{node.title}</strong>
          {node.body ? <div>{node.body}</div> : null}
          {node.children.length > 0 ? <OutlineTree nodes={node.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

// A planning board: pan, zoom, drag cards, and draw arrows. Ciciro can fill a
// card or draft an outline, and nothing from that reaches the manuscript.
export default function CanvasBoard({ projectId, onClose }: Props) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [view, setView] = useState<View>({ x: 48, y: 36, scale: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<string[]>([]);
  const [linking, setLinking] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState<CanvasLabelColor>("accent");
  const [hist, setHist] = useState({ undo: 0, redo: 0 });

  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const cardEls = useRef(new Map<string, HTMLElement>());
  const savedText = useRef(new Map<string, { title: string; body: string }>());
  const past = useRef<Step[]>([]);
  const future = useRef<Step[]>([]);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const stopPointer = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => stopPointer.current?.();
  }, []);

  function trackPointer(move: (ev: PointerEvent) => void, up: (ev: PointerEvent) => void) {
    stopPointer.current?.();
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (stopPointer.current === stop) stopPointer.current = null;
    };
    stopPointer.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return stop;
  }

  const remember = useCallback((step: Step) => {
    past.current = [...past.current.slice(-49), step];
    future.current = [];
    setHist({ undo: past.current.length, redo: 0 });
  }, []);

  const fail = useCallback((e: unknown, fallback: string) => {
    setError(e instanceof Error ? e.message : fallback);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/canvas`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorOf(data, "Couldn't open the canvas."));
    const nextCards: Card[] = Array.isArray(data.cards) ? data.cards : [];
    setLabels(Array.isArray(data.labels) ? data.labels : []);
    setCards(nextCards);
    setEdges(Array.isArray(data.edges) ? data.edges : []);
    savedText.current = new Map(nextCards.map((card) => [card.id, { title: card.title, body: card.body }]));
  }, [projectId]);

  useEffect(() => {
    load().catch((e) => fail(e, "Couldn't open the canvas."));
  }, [load, fail]);

  // Measures every render on purpose (any edit can change a card's height);
  // setHeights only runs when a height actually changed, so it cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    let changed = false;
    for (const [id, el] of cardEls.current) {
      next[id] = el.offsetHeight;
      if (heights[id] !== el.offsetHeight) changed = true;
    }
    if (changed || Object.keys(heights).length !== Object.keys(next).length) setHeights(next);
  });

  function clientToWorld(clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - v.x) / v.scale, y: (clientY - rect.top - v.y) / v.scale };
  }

  function port(card: Card, side: "left" | "right") {
    const h = heights[card.id] ?? 140;
    return {
      x: card.x + (side === "right" ? CANVAS_CARD_WIDTH : 0),
      y: card.y + h / 2,
    };
  }

  async function request(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorOf(data, "The canvas couldn't save that."));
    return data;
  }

  const base = `/api/projects/${projectId}/canvas`;

  function applyCard(card: Card) {
    setCards((rows) => rows.map((row) => (row.id === card.id ? card : row)));
  }

  async function patchCard(id: string, body: Record<string, unknown>): Promise<Card> {
    const data = (await request(`${base}/cards/${id}`, "PATCH", body)) as Card;
    // Apply only the fields this request wrote. A label save that returns a
    // moment before a title save must not put the old title back.
    setCards((rows) =>
      rows.map((row) => {
        if (row.id !== id) return row;
        return {
          ...row,
          ...("title" in body ? { title: data.title } : {}),
          ...("body" in body ? { body: data.body } : {}),
          ...("x" in body ? { x: data.x } : {}),
          ...("y" in body ? { y: data.y } : {}),
          ...("labelIds" in body ? { labelIds: data.labelIds } : {}),
        };
      })
    );
    if ("title" in body || "body" in body) {
      const prior = savedText.current.get(id);
      savedText.current.set(id, {
        title: "title" in body ? data.title : (prior?.title ?? data.title),
        body: "body" in body ? data.body : (prior?.body ?? data.body),
      });
    }
    return data;
  }

  function onStagePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".canvas-card, .canvas-zoom, button, input, select, textarea")) return;
    setSelectedId(null);
    const origin = { ...viewRef.current };
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      const next = { ...origin, x: origin.x + ev.clientX - startX, y: origin.y + ev.clientY - startY };
      viewRef.current = next;
      setView(next);
    };
    const up = () => stop();
    const stop = trackPointer(move, up);
  }

  function onCardPointerDown(e: React.PointerEvent, card: Card) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, button, select, .canvas-port")) return;
    e.stopPropagation();
    setSelectedId(card.id);
    const start = clientToWorld(e.clientX, e.clientY);
    const origin = { x: card.x, y: card.y };
    let x = origin.x;
    let y = origin.y;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const now = clientToWorld(ev.clientX, ev.clientY);
      x = origin.x + (now.x - start.x);
      y = origin.y + (now.y - start.y);
      if (Math.hypot(x - origin.x, y - origin.y) > 3) moved = true;
      setCards((rows) => rows.map((row) => (row.id === card.id ? { ...row, x, y } : row)));
    };
    const up = () => {
      stop();
      if (!moved) return;
      const from = origin;
      const to = { x, y };
      void patchCard(card.id, to)
        .then(() =>
          remember({
            undo: async () => {
              await patchCard(card.id, from);
            },
            redo: async () => {
              await patchCard(card.id, to);
            },
          })
        )
        .catch((err) => fail(err, "Couldn't save that position."));
    };
    const stop = trackPointer(move, up);
  }

  function onPortPointerDown(e: React.PointerEvent, card: Card) {
    e.stopPropagation();
    e.preventDefault();
    const from = port(card, "right");
    setLinking({ fromId: card.id, x: from.x, y: from.y });
    const move = (ev: PointerEvent) => {
      const at = clientToWorld(ev.clientX, ev.clientY);
      setLinking({ fromId: card.id, x: at.x, y: at.y });
    };
    const up = (ev: PointerEvent) => {
      stop();
      setLinking(null);
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const toId = hit?.closest("[data-card-id]")?.getAttribute("data-card-id");
      if (!toId || toId === card.id) return;
      if (edgesRef.current.some((edge) => edge.fromId === card.id && edge.toId === toId)) return;
      void connect(card.id, toId);
    };
    const stop = trackPointer(move, up);
  }

  async function connect(fromId: string, toId: string) {
    setError("");
    try {
      const edge = (await request(`${base}/edges`, "POST", { fromId, toId })) as Edge;
      setEdges((rows) => (rows.some((row) => row.id === edge.id) ? rows : [...rows, edge]));
      let id = edge.id;
      remember({
        undo: async () => {
          await request(`${base}/edges/${id}`, "DELETE");
          setEdges((rows) => rows.filter((row) => row.id !== id));
        },
        redo: async () => {
          const again = (await request(`${base}/edges`, "POST", { fromId, toId })) as Edge;
          id = again.id;
          setEdges((rows) => (rows.some((row) => row.id === again.id) ? rows : [...rows, again]));
        },
      });
    } catch (err) {
      fail(err, "Couldn't connect those cards.");
    }
  }

  async function addCard() {
    setError("");
    const rect = stageRef.current?.getBoundingClientRect();
    const center = rect
      ? clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : { x: 120, y: 80 };
    try {
      let card = (await request(`${base}/cards`, "POST", {
        title: "Untitled",
        x: center.x - CANVAS_CARD_WIDTH / 2,
        y: center.y - 70,
      })) as Card;
      setCards((rows) => [...rows, card]);
      savedText.current.set(card.id, { title: card.title, body: card.body });
      setSelectedId(card.id);
      getAnalytics().track("canvas_card_created", {});
      remember({
        undo: async () => {
          await request(`${base}/cards/${card.id}`, "DELETE");
          setCards((rows) => rows.filter((row) => row.id !== card.id));
          setEdges((rows) => rows.filter((row) => row.fromId !== card.id && row.toId !== card.id));
        },
        redo: async () => {
          card = (await request(`${base}/cards`, "POST", {
            title: card.title,
            body: card.body,
            x: card.x,
            y: card.y,
          })) as Card;
          setCards((rows) => [...rows, card]);
        },
      });
    } catch (err) {
      fail(err, "Couldn't add a card.");
    }
  }

  async function removeCard(card: Card) {
    setError("");
    const related = edgesRef.current.filter((edge) => edge.fromId === card.id || edge.toId === card.id);
    try {
      await request(`${base}/cards/${card.id}`, "DELETE");
      setCards((rows) => rows.filter((row) => row.id !== card.id));
      setEdges((rows) => rows.filter((row) => row.fromId !== card.id && row.toId !== card.id));
      if (selectedId === card.id) setSelectedId(null);
      let id = card.id;
      remember({
        undo: async () => {
          const created = (await request(`${base}/cards`, "POST", {
            title: card.title,
            body: card.body,
            x: card.x,
            y: card.y,
          })) as Card;
          id = created.id;
          if (card.labelIds.length) await request(`${base}/cards/${id}`, "PATCH", { labelIds: card.labelIds });
          const restored: Edge[] = [];
          for (const edge of related) {
            const fromId = edge.fromId === card.id ? id : edge.fromId;
            const toId = edge.toId === card.id ? id : edge.toId;
            if (!cardsRef.current.some((row) => row.id === fromId) && fromId !== id) continue;
            if (!cardsRef.current.some((row) => row.id === toId) && toId !== id) continue;
            restored.push((await request(`${base}/edges`, "POST", { fromId, toId })) as Edge);
          }
          setCards((rows) => [...rows, { ...created, labelIds: card.labelIds }]);
          setEdges((rows) => [...rows, ...restored]);
        },
        redo: async () => {
          await request(`${base}/cards/${id}`, "DELETE");
          setCards((rows) => rows.filter((row) => row.id !== id));
          setEdges((rows) => rows.filter((row) => row.fromId !== id && row.toId !== id));
        },
      });
    } catch (err) {
      fail(err, "Couldn't remove that card.");
    }
  }

  async function commitText(card: Card, field: "title" | "body", value: string) {
    const saved = savedText.current.get(card.id);
    if (!saved || saved[field] === value) return;
    const before = saved[field];
    try {
      await patchCard(card.id, { [field]: value });
      remember({
        undo: async () => {
          await patchCard(card.id, { [field]: before });
        },
        redo: async () => {
          await patchCard(card.id, { [field]: value });
        },
      });
    } catch (err) {
      fail(err, "Couldn't save that card.");
    }
  }

  async function toggleLabel(card: Card, labelId: string) {
    const before = card.labelIds;
    const labelIds = before.includes(labelId) ? before.filter((id) => id !== labelId) : [...before, labelId];
    try {
      await patchCard(card.id, { labelIds });
      remember({
        undo: async () => {
          await patchCard(card.id, { labelIds: before });
        },
        redo: async () => {
          await patchCard(card.id, { labelIds });
        },
      });
    } catch (err) {
      fail(err, "Couldn't update labels.");
    }
  }

  async function addLabel() {
    const name = labelName.trim();
    if (!name) return;
    setError("");
    try {
      const label = (await request(`${base}/labels`, "POST", { name, color: labelColor })) as Label;
      setLabels((rows) => [...rows, label].sort((a, b) => a.name.localeCompare(b.name)));
      setLabelName("");
    } catch (err) {
      fail(err, "Couldn't add that label.");
    }
  }

  async function generate(mode: "fill" | "options" | "outline", cardId: string) {
    const card = cardsRef.current.find((row) => row.id === cardId);
    if (!card) return;
    setBusy(true);
    setError("");
    setSelectedId(cardId);
    try {
      const res = await fetch(`${base}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, cardId }),
      });
      const data = await res.json().catch(() => ({}));
      reportAiLimit(res.status, data);
      if (!res.ok) throw new Error(errorOf(data, "Ciciro couldn't draft that."));
      if (data.mode === "fill" && typeof data.body === "string") {
        setPreview({ mode: "fill", cardId, body: data.body, previous: card.body });
      } else if (data.mode === "options" && Array.isArray(data.options)) {
        setPreview({ mode: "options", cardId, options: data.options, previous: card.body });
      } else if (data.mode === "outline" && typeof data.raw === "string" && Array.isArray(data.nodes)) {
        setPreview({ mode: "outline", cardId, raw: data.raw, nodes: data.nodes });
      } else {
        throw new Error("Ciciro's reply couldn't be read. Nothing was added.");
      }
    } catch (err) {
      fail(err, "Ciciro couldn't draft that.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptFill(body: string) {
    if (!preview || preview.mode === "outline") return;
    const { cardId, previous } = preview;
    setBusy(true);
    setError("");
    try {
      await patchCard(cardId, { body });
      setPreview(null);
      getAnalytics().track("canvas_generated", { mode: preview.mode === "options" ? "options" : "fill" });
      remember({
        undo: async () => {
          await patchCard(cardId, { body: previous });
        },
        redo: async () => {
          await patchCard(cardId, { body });
        },
      });
    } catch (err) {
      fail(err, "Couldn't update that card.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptOutline() {
    if (!preview || preview.mode !== "outline") return;
    const { cardId, raw } = preview;
    setBusy(true);
    setError("");
    try {
      const data = await request(`${base}/outline`, "POST", { cardId, raw });
      const ids: string[] = Array.isArray(data.cardIds) ? data.cardIds : [];
      await load();
      setPreview(null);
      getAnalytics().track("canvas_generated", { mode: "outline" });
      let current = ids;
      remember({
        undo: async () => {
          for (const id of current) {
            await request(`${base}/cards/${id}`, "DELETE").catch(() => {});
          }
          current = [];
          await load();
        },
        redo: async () => {
          const again = await request(`${base}/outline`, "POST", { cardId, raw });
          current = Array.isArray(again.cardIds) ? again.cardIds : [];
          await load();
        },
      });
    } catch (err) {
      fail(err, "No cards were added.");
    } finally {
      setBusy(false);
    }
  }

  function zoomBy(factor: number) {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const v = viewRef.current;
    const px = rect.width / 2;
    const py = rect.height / 2;
    const nextScale = Math.min(2.2, Math.max(0.35, v.scale * factor));
    const wx = (px - v.x) / v.scale;
    const wy = (py - v.y) / v.scale;
    const next = { scale: nextScale, x: px - wx * nextScale, y: py - wy * nextScale };
    viewRef.current = next;
    setView(next);
  }

  undoRef.current = () => {
    const step = past.current.pop();
    if (!step) return;
    future.current.push(step);
    setHist({ undo: past.current.length, redo: future.current.length });
    void step.undo().catch((err) => fail(err, "Couldn't undo that."));
  };
  redoRef.current = () => {
    const step = future.current.pop();
    if (!step) return;
    past.current.push(step);
    setHist({ undo: past.current.length, redo: future.current.length });
    void step.redo().catch((err) => fail(err, "Couldn't redo that."));
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const nextScale = Math.min(2.2, Math.max(0.35, v.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      const wx = (px - v.x) / v.scale;
      const wy = (py - v.y) / v.scale;
      const next = { scale: nextScale, x: px - wx * nextScale, y: py - wy * nextScale };
      viewRef.current = next;
      setView(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (preview) setPreview(null);
        else onClose();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea")) return;
      e.preventDefault();
      if (e.shiftKey) redoRef.current();
      else undoRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, preview]);

  const visible = new Set(
    cards
      .filter((card) => filters.length === 0 || card.labelIds.some((id) => filters.includes(id)))
      .map((card) => card.id)
  );
  const selected = cards.find((card) => card.id === selectedId) ?? null;
  const byId = new Map(cards.map((card) => [card.id, card]));

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="canvas-panel" role="dialog" aria-label="Planning canvas">
        <div className="canvas-head">
          <h2>Canvas</h2>
          <span className="outline-hint">Drag the board to pan. Drag a card to move it. Drag a dot to connect.</span>
          <span className="spacer" />
          <button className="btn ghost small" disabled={hist.undo === 0} onClick={() => undoRef.current()}>
            Undo
          </button>
          <button className="btn ghost small" disabled={hist.redo === 0} onClick={() => redoRef.current()}>
            Redo
          </button>
          <button className="btn small" onClick={addCard}>
            Add card
          </button>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="canvas-labels">
          <button
            className={`btn small ${filters.length === 0 ? "primary" : "ghost"}`}
            onClick={() => setFilters([])}
          >
            All
          </button>
          {labels.map((label) => (
            <button
              key={label.id}
              className={`canvas-chip ${filters.includes(label.id) ? "on" : ""}`}
              data-color={label.color}
              aria-pressed={filters.includes(label.id)}
              onClick={() =>
                setFilters((current) =>
                  current.includes(label.id) ? current.filter((id) => id !== label.id) : [...current, label.id]
                )
              }
            >
              {label.name}
            </button>
          ))}
          <input
            aria-label="New label"
            placeholder="New label"
            value={labelName}
            onChange={(e) => setLabelName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addLabel();
            }}
          />
          <span className="canvas-swatches" role="group" aria-label="Label color">
            {CANVAS_LABEL_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`canvas-swatch${labelColor === color ? " on" : ""}`}
                data-color={color}
                aria-label={color}
                aria-pressed={labelColor === color}
                onClick={() => setLabelColor(color)}
              />
            ))}
          </span>
          <button className="btn ghost small" disabled={!labelName.trim()} onClick={() => void addLabel()}>
            Add label
          </button>
          {selected && (
            <span className="canvas-actions">
              <button className="btn ghost small" disabled={busy} onClick={() => void generate("fill", selected.id)}>
                Fill this
              </button>
              <button className="btn ghost small" disabled={busy} onClick={() => void generate("options", selected.id)}>
                Options
              </button>
              <button
                className="btn ghost small"
                disabled={busy}
                onClick={() => void generate("outline", selected.id)}
              >
                Generate full outline
              </button>
              <button className="btn ghost small" onClick={() => void removeCard(selected)}>
                Delete
              </button>
            </span>
          )}
        </div>

        {error && (
          <div className="scratch-error" role="alert">
            {error}
          </div>
        )}

        <div
          className="canvas-stage"
          ref={stageRef}
          onPointerDown={onStagePointerDown}
          style={{
            backgroundSize: `${22 * view.scale}px ${22 * view.scale}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        >
          <div
            className="canvas-world"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          >
            <svg className="canvas-edges" aria-hidden="true">
              {edges.map((edge) => {
                if (!visible.has(edge.fromId) || !visible.has(edge.toId)) return null;
                const from = byId.get(edge.fromId);
                const to = byId.get(edge.toId);
                if (!from || !to) return null;
                return <path key={edge.id} d={curveBetween(port(from, "right"), port(to, "left"))} />;
              })}
              {linking && byId.get(linking.fromId)
                ? (
                    <path
                      className="draft"
                      d={curveBetween(port(byId.get(linking.fromId)!, "right"), { x: linking.x, y: linking.y })}
                    />
                  )
                : null}
            </svg>
            {cards.map((card) =>
              visible.has(card.id) ? (
                <article
                  key={card.id}
                  data-card-id={card.id}
                  ref={(el) => {
                    if (el) cardEls.current.set(card.id, el);
                    else cardEls.current.delete(card.id);
                  }}
                  className={`canvas-card${card.id === selectedId ? " selected" : ""}`}
                  style={{ left: card.x, top: card.y }}
                  onPointerDown={(e) => onCardPointerDown(e, card)}
                >
                  <input
                    className="canvas-card-title"
                    aria-label="Card title"
                    value={card.title}
                    onChange={(e) => applyCard({ ...card, title: e.target.value })}
                    onBlur={(e) => void commitText(card, "title", e.target.value)}
                  />
                  <div className="canvas-card-labels">
                    {labels
                      .filter((label) => card.labelIds.includes(label.id))
                      .map((label) => (
                        <button
                          key={label.id}
                          type="button"
                          className="canvas-chip"
                          data-color={label.color}
                          onClick={() => void toggleLabel(card, label.id)}
                          title="Remove this label"
                        >
                          {label.name}
                        </button>
                      ))}
                    {labels
                      .filter((label) => !card.labelIds.includes(label.id))
                      .slice(0, 4)
                      .map((label) => (
                        <button
                          key={label.id}
                          type="button"
                          className="canvas-chip ghost"
                          data-color={label.color}
                          onClick={() => void toggleLabel(card, label.id)}
                        >
                          + {label.name}
                        </button>
                      ))}
                  </div>
                  <textarea
                    className="canvas-card-body"
                    aria-label="Card notes"
                    value={card.body}
                    rows={4}
                    onChange={(e) => applyCard({ ...card, body: e.target.value })}
                    onBlur={(e) => void commitText(card, "body", e.target.value)}
                  />
                  <button
                    type="button"
                    className="canvas-port"
                    aria-label={`Connect ${card.title || "card"}`}
                    onPointerDown={(e) => onPortPointerDown(e, card)}
                  />
                  <button
                    className="btn ghost small canvas-fill"
                    disabled={busy}
                    onClick={() => void generate("fill", card.id)}
                  >
                    Fill this
                  </button>
                </article>
              ) : null
            )}
          </div>
          <div className="canvas-zoom">
            <button className="btn small" aria-label="Zoom in" onClick={() => zoomBy(1.12)}>
              +
            </button>
            <button className="btn small" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.12)}>
              −
            </button>
          </div>
        </div>

        {preview && (
          <div className="canvas-preview" role="dialog" aria-label="Accept onto the canvas">
            <div className="canvas-preview-card">
              {preview.mode === "fill" && (
                <>
                  <h3>Fill this card</h3>
                  <p>{preview.body}</p>
                  <div className="beta-actions">
                    <button className="btn primary small" disabled={busy} onClick={() => void acceptFill(preview.body)}>
                      Accept
                    </button>
                    <button className="btn ghost small" onClick={() => setPreview(null)}>
                      Dismiss
                    </button>
                  </div>
                </>
              )}
              {preview.mode === "options" && (
                <>
                  <h3>Options</h3>
                  {preview.options.map((option) => (
                    <div key={option} className="canvas-option">
                      <p>{option}</p>
                      <button className="btn primary small" disabled={busy} onClick={() => void acceptFill(option)}>
                        Use this
                      </button>
                    </div>
                  ))}
                  <button className="btn ghost small" onClick={() => setPreview(null)}>
                    Dismiss
                  </button>
                </>
              )}
              {preview.mode === "outline" && (
                <>
                  <h3>Generate full outline</h3>
                  <p className="scratch-hint">
                    Accept adds these cards under the one you selected, and draws the arrows. Nothing is written
                    into the manuscript.
                  </p>
                  <OutlineTree nodes={preview.nodes} />
                  <div className="beta-actions">
                    <button className="btn primary small" disabled={busy} onClick={() => void acceptOutline()}>
                      Accept
                    </button>
                    <button className="btn ghost small" onClick={() => setPreview(null)}>
                      Dismiss
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
