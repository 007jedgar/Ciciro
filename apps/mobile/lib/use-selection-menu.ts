import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GestureResponderEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { announce } from "./announce";
import { getAnalytics } from "./analytics-client";
import {
  matchCase,
  selectionKind,
  splitWord,
  synonymContext,
  synonymEligible,
  type SelectionActionId,
  type SynonymContext,
} from "./selection-menu";
import { setSelectionDock, type SelectionDockModel } from "./selection-dock";
import { useSynonyms, type Synonyms } from "./use-synonyms";

const IDLE_SYNONYMS: Synonyms = { status: "idle", list: [] };

/**
 * How long a selection must hold still, with no finger on the page, before the
 * strip opens. On iOS the editor says nothing while a handle is being dragged
 * (the selection arrives once, when the finger lifts), so a finger on the page
 * is what keeps the strip away then (see `onTouchStart`); this wait outlasts
 * the burst of changes a double-tap makes. On Android it is all there is: a
 * handle drag sends a change per move there, and a writer's pause between
 * moves is well past a quarter of a second.
 */
export const SELECTION_SETTLE_MS = 450;

/**
 * A touch that never reports its end (a native view that kept it) must not
 * hold the strip off for good: after this long it counts as lifted.
 */
export const TOUCH_GUARD_MS = 5000;

type Selected = {
  text: string;
  target: "word" | "passage";
  /** The one word of a one-word selection, with the editor offsets of just the word. */
  word: { text: string; start: number; end: number; context: SynonymContext | null } | null;
};

/** Where the paragraph holding `offset` starts and ends in the chapter's plain text. */
function paragraphBounds(text: string, offset: number): { from: number; to: number } {
  const from = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const next = text.indexOf("\n", offset);
  return { from, to: next < 0 ? text.length : next };
}

/**
 * Drives the strip over highlighted text on the manuscript screen. The screen
 * reports the selection and the touches on the page; this opens the strip once
 * the selection has settled, looks up synonyms for a single word, and publishes
 * what the strip shows (`lib/selection-dock.ts`) for the project header to
 * draw. The strip closes the moment a finger touches the page, the selection
 * moves again, focus is lost or the chapter changes, and comes back once the
 * finger has lifted and the selection has held still.
 */
export function useSelectionMenu({
  chapterId,
  focused,
  getText,
  replaceWord,
  onAction,
}: {
  chapterId: string | undefined;
  focused: boolean;
  /** The chapter's plain text as the editor shows it (paragraphs newline-separated), live. */
  getText: () => string | null;
  /** Swap the word at editor offsets `[start, end)`; false when the page no longer holds it. */
  replaceWord: (start: number, end: number, expected: string, replacement: string) => Promise<boolean>;
  /** A button other than a synonym: the screen takes the selected text to the chat. */
  onAction: (action: SelectionActionId, text: string) => void;
}): {
  onChangeSelection: (start: number, end: number) => void;
  /** For the view around the editor: a finger on the page hides the strip until it lifts. */
  onTouchStart: (event: GestureResponderEvent) => void;
  onTouchEnd: (event: GestureResponderEvent) => void;
} {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Selected | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getTextRef = useRef(getText);
  getTextRef.current = getText;
  const selectedRef = useRef<Selected | null>(null);
  selectedRef.current = selected;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  /** The selection the editor last reported, and whether a finger is on the page now. */
  const range = useRef<{ start: number; end: number } | null>(null);
  const touching = useRef(false);
  const guard = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const clear = useCallback(() => {
    cancelTimer();
    range.current = null;
    setSelected(null);
  }, [cancelTimer]);

  useEffect(() => {
    if (!focused) clear();
  }, [focused, clear]);

  useEffect(() => {
    clear();
  }, [chapterId, clear]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (guard.current) clearTimeout(guard.current);
      setSelectionDock(null);
    },
    []
  );

  /** Opens the strip for the selection last reported, once it has held still. */
  const settle = useCallback(() => {
    cancelTimer();
    const reported = range.current;
    if (!reported || reported.end <= reported.start || !focusedRef.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const current = range.current;
      const plain = getTextRef.current();
      if (!current || plain === null) return;
      const { start, end } = current;
      const text = plain.slice(start, end);
      const target = selectionKind(text);
      if (target === "none") return;
      let word: Selected["word"] = null;
      if (target === "word") {
        const split = splitWord(text);
        if (split && synonymEligible(split.word)) {
          const wordStart = start + split.lead.length;
          const wordEnd = wordStart + split.word.length;
          const { from, to } = paragraphBounds(plain, wordStart);
          word = {
            text: split.word,
            start: wordStart,
            end: wordEnd,
            context: synonymContext(plain.slice(from, to), wordStart - from, wordEnd - from),
          };
        }
      }
      setSelected({ text, target, word });
    }, SELECTION_SETTLE_MS);
  }, [cancelTimer]);

  const onChangeSelection = useCallback(
    (start: number, end: number) => {
      range.current = { start, end };
      cancelTimer();
      setSelected(null);
      // A finger still down (a handle mid-drag) is not a selection to act on yet; its lift settles it.
      if (!touching.current) settle();
    },
    [cancelTimer, settle]
  );

  const liftFinger = useCallback(() => {
    touching.current = false;
    if (guard.current) clearTimeout(guard.current);
    guard.current = null;
  }, []);

  const onTouchStart = useCallback(() => {
    touching.current = true;
    cancelTimer();
    setSelected(null);
    if (guard.current) clearTimeout(guard.current);
    guard.current = setTimeout(() => {
      liftFinger();
      settle();
    }, TOUCH_GUARD_MS);
  }, [cancelTimer, liftFinger, settle]);

  const onTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      if (event.nativeEvent.touches.length > 0) return;
      liftFinger();
      settle();
    },
    [liftFinger, settle]
  );

  const synonyms = useSynonyms(selected?.word?.context ?? null);

  const handleAction = useCallback(
    (action: SelectionActionId) => {
      const current = selectedRef.current;
      if (!current) return;
      getAnalytics().track("selection_action_used", { action, target: current.target });
      onAction(action, current.text);
    },
    [onAction]
  );

  const handleSynonym = useCallback(
    (synonym: string, fromMore: boolean) => {
      const current = selectedRef.current;
      const word = current?.word;
      if (!word) return;
      const replacement = matchCase(word.text, synonym);
      void replaceWord(word.start, word.end, word.text, replacement).then((replaced) => {
        if (!replaced) return;
        getAnalytics().track("synonym_used", { more: fromMore });
        announce(t("selectionMenu.replacedAnnounce", { synonym: replacement }));
        clear();
      });
    },
    [clear, replaceWord, t]
  );

  const model = useMemo<SelectionDockModel | null>(
    () =>
      selected && focused
        ? {
            target: selected.target,
            word: selected.word?.text ?? selected.text,
            synonyms: selected.word ? synonyms : IDLE_SYNONYMS,
            onAction: handleAction,
            onSynonym: handleSynonym,
          }
        : null,
    [selected, focused, synonyms, handleAction, handleSynonym]
  );

  useEffect(() => {
    setSelectionDock(model);
  }, [model]);

  return { onChangeSelection, onTouchStart, onTouchEnd };
}
