import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSharedValue } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { OnSelectionFrameEvent } from "react-native-enriched-html";
import { AnchoredSelectionMenu, InlineSelectionMenu } from "../components/SelectionMenu";
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
import { frameFromEvent, type SelectionFrame } from "./selection-menu-view";
import { useSynonyms, type Synonyms } from "./use-synonyms";

const IDLE_SYNONYMS: Synonyms = { status: "idle", list: [] };

/** How long a selection must hold still before the menu opens: not while a handle is being dragged. */
export const SELECTION_SETTLE_MS = 220;

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
 * Drives the menu over highlighted text on the manuscript screen. The screen
 * reports the selection and the native editor's frame for it; this opens the
 * menu once the selection has settled, looks up synonyms for a single word,
 * and hands back the menu to draw: `anchored` hung by the selection when the
 * editor reports where it is, `inline` for an editor that cannot (it shows at
 * the top of the page like the format bubble).
 */
export function useSelectionMenu({
  chapterId,
  focused,
  bounds,
  getText,
  replaceWord,
  onAction,
}: {
  chapterId: string | undefined;
  focused: boolean;
  /** The editor area the menu has to stay inside. */
  bounds: { width: number; height: number };
  /** The chapter's plain text as the editor shows it (paragraphs newline-separated), live. */
  getText: () => string | null;
  /** Swap the word at editor offsets `[start, end)`; false when the page no longer holds it. */
  replaceWord: (start: number, end: number, expected: string, replacement: string) => Promise<boolean>;
  /** A button other than a synonym: the screen takes the selected text to the chat. */
  onAction: (action: SelectionActionId, text: string) => void;
}): {
  onChangeSelection: (start: number, end: number) => void;
  onSelectionFrame: (event: OnSelectionFrameEvent) => void;
  anchored: ReactNode;
  inline: ReactNode;
  open: boolean;
} {
  const { t } = useTranslation();
  const frame = useSharedValue<SelectionFrame | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getTextRef = useRef(getText);
  getTextRef.current = getText;
  const selectedRef = useRef<Selected | null>(null);
  selectedRef.current = selected;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSelected(null);
    frame.value = null;
  }, [frame]);

  useEffect(() => {
    if (!focused) clear();
  }, [focused, clear]);

  useEffect(() => {
    clear();
  }, [chapterId, clear]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const onChangeSelection = useCallback(
    (start: number, end: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setSelected(null);
      if (end <= start || !focusedRef.current) {
        frame.value = null;
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        const plain = getTextRef.current();
        if (plain === null) return;
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
    },
    [frame]
  );

  const onSelectionFrame = useCallback(
    (event: OnSelectionFrameEvent) => {
      frame.value = frameFromEvent(event);
      setHasFrame(true);
    },
    [frame]
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

  const props =
    selected && focused
      ? {
          target: selected.target,
          word: selected.word?.text ?? selected.text,
          synonyms: selected.word ? synonyms : IDLE_SYNONYMS,
          onAction: handleAction,
          onSynonym: handleSynonym,
        }
      : null;
  const maxWidth = Math.max(0, bounds.width - 16);

  return {
    onChangeSelection,
    onSelectionFrame,
    open: Boolean(props),
    anchored:
      props && hasFrame && bounds.width > 0 ? (
        <AnchoredSelectionMenu
          key={selected?.text}
          {...props}
          frame={frame}
          boundsWidth={bounds.width}
          boundsHeight={bounds.height}
          maxWidth={maxWidth}
        />
      ) : null,
    inline: props && !hasFrame ? <InlineSelectionMenu key={selected?.text} {...props} maxWidth={maxWidth || 360} /> : null,
  };
}
