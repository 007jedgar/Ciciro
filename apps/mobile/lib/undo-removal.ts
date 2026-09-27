import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/** How long "Deleted, Undo" stays up before the delete goes through. */
export const UNDO_WINDOW_MS = 6000;

type Pending = { id: string; message: string; commit: () => void };

/**
 * Remove-and-undo for a list row. The row is hidden at once (the list slides
 * it out); the real delete waits out the undo window and only then runs, so
 * "Undo" costs nothing and needs no server-side restore. A second delete while
 * one is waiting commits the first straight away, and leaving the screen or
 * backgrounding the app commits whatever is still waiting so a delete is never
 * dropped.
 *
 * `commit` may reject: the row comes back and `onFailed` gets the error.
 */
export function useUndoableRemoval({
  windowMs = UNDO_WINDOW_MS,
  onFailed,
}: {
  windowMs?: number;
  onFailed?: (id: string, error: unknown) => void;
} = {}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ id: string; message: string } | null>(null);
  const pending = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(onFailed);
  failed.current = onFailed;

  const unhide = useCallback((id: string) => {
    setHidden((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const item = pending.current;
    pending.current = null;
    setNotice(null);
    if (!item) return;
    void Promise.resolve()
      .then(item.commit)
      .then(
        () => unhide(item.id),
        (error: unknown) => {
          unhide(item.id);
          failed.current?.(item.id, error);
        }
      );
  }, [unhide]);

  const remove = useCallback(
    (id: string, message: string, commit: () => void | Promise<unknown>) => {
      flush();
      pending.current = { id, message, commit: commit as () => void };
      setHidden((current) => new Set(current).add(id));
      setNotice({ id, message });
      timer.current = setTimeout(flush, windowMs);
    },
    [flush, windowMs]
  );

  const undo = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const item = pending.current;
    pending.current = null;
    setNotice(null);
    if (item) unhide(item.id);
  }, [unhide]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  return { hidden, notice, remove, undo };
}
