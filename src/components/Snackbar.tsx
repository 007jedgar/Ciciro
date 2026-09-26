"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MOTION_MS, motionMs } from "@/lib/motion";

export const SNACKBAR_MS = 6000;

export type SnackbarInput = {
  message: string;
  /** Label of the button, e.g. "Undo". Needs `onAction`. */
  actionLabel?: string;
  /** The button was pressed. `onCommit` is then skipped. */
  onAction?: () => void;
  /**
   * The point of no return for a deferred action (a delete): runs when the
   * snackbar times out, is replaced, or the page is hidden, unless the button
   * was pressed first.
   */
  onCommit?: () => void | Promise<void>;
  duration?: number;
};

type Show = (input: SnackbarInput) => void;

type Item = SnackbarInput & { id: number; state: "open" | "closed" };

const SnackbarContext = createContext<Show | null>(null);

/** Without a provider (tests, isolated renders) a deferred action commits at once. */
const commitNow: Show = (input) => {
  void input.onCommit?.();
};

export function useSnackbar(): Show {
  return useContext(SnackbarContext) ?? commitNow;
}

// One snackbar at a time, bottom centre. Showing another settles the one on
// screen: its deferred work commits rather than being dropped.
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<Item | null>(null);
  const live = useRef<Item | null>(null);
  const settled = useRef(new Set<number>());
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remaining = useRef(0);
  const startedAt = useRef(0);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const commit = useCallback((target: Item | null) => {
    if (!target || settled.current.has(target.id)) return;
    settled.current.add(target.id);
    void target.onCommit?.();
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    const current = live.current;
    if (!current) return;
    live.current = null;
    setItem({ ...current, state: "closed" });
    if (removeTimer.current) clearTimeout(removeTimer.current);
    removeTimer.current = setTimeout(
      () => setItem((now) => (now && now.id === current.id ? null : now)),
      motionMs(MOTION_MS.popoverOut + 80)
    );
  }, []);

  const arm = useCallback(
    (ms: number) => {
      clearTimer();
      remaining.current = ms;
      startedAt.current = Date.now();
      timer.current = setTimeout(() => {
        commit(live.current);
        dismiss();
      }, ms);
    },
    [commit, dismiss]
  );

  const show = useCallback<Show>(
    (input) => {
      commit(live.current);
      const next: Item = { ...input, id: ++nextId.current, state: "open" };
      live.current = next;
      setItem(next);
      arm(input.duration ?? SNACKBAR_MS);
    },
    [arm, commit]
  );

  // Leaving the page must not lose a delete the writer already saw go.
  useEffect(() => {
    const flush = () => commit(live.current);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
      clearTimer();
      if (removeTimer.current) clearTimeout(removeTimer.current);
    };
  }, [commit]);

  const pause = () => {
    if (!live.current || !timer.current) return;
    remaining.current = Math.max(1000, remaining.current - (Date.now() - startedAt.current));
    clearTimer();
  };
  const resume = () => {
    if (live.current && !timer.current) arm(remaining.current);
  };

  const value = useMemo(() => show, [show]);

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <div className="snackbar-region" role="status" aria-live="polite">
        {item ? (
          <div
            key={item.id}
            className="snackbar"
            data-state={item.state}
            onMouseEnter={pause}
            onMouseLeave={resume}
            onFocus={pause}
            onBlur={resume}
          >
            <span className="snackbar-message">{item.message}</span>
            {item.actionLabel && item.onAction ? (
              <button
                type="button"
                className="snackbar-action"
                onClick={() => {
                  const acted = live.current;
                  if (!acted) return;
                  settled.current.add(acted.id);
                  acted.onAction?.();
                  dismiss();
                }}
              >
                {item.actionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SnackbarContext.Provider>
  );
}
