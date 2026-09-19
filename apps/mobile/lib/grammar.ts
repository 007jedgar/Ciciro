export const GRAMMAR_IDLE_MS = 800;
export const GRAMMAR_AUTO_ACCEPT_MS = 3000;

export type CorrectionSpan = {
  start: number;
  end: number;
  replacement: string;
};

export type GrammarSuggestion = {
  chapterId: string;
  blockId: string;
  text: string;
  spans: CorrectionSpan[];
  shownAt: number;
};

export type GrammarRequest = (input: {
  chapterId: string;
  blockId: string;
  text: string;
  revision: number;
  signal: AbortSignal;
}) => Promise<{ spans: CorrectionSpan[] }>;

export type TextLineMetrics = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

export type SpanAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function endedOnSentence(text: string): boolean {
  return /[.!?。！？]["'”’)\]]?\s*$/.test(text);
}

export function shouldRequestCorrect(opts: {
  autoCorrect: boolean;
  composing: boolean;
  text: string;
}): boolean {
  return Boolean(opts.autoCorrect && !opts.composing && opts.text.trim());
}

/** Spans whose original slice is still present at the same offsets. */
export function matchingSpans(
  text: string,
  originalText: string,
  spans: CorrectionSpan[]
): CorrectionSpan[] {
  return spans.filter((span) => {
    if (span.start < 0 || span.end > text.length || span.start >= span.end) return false;
    const expected = originalText.slice(span.start, span.end);
    return expected.length > 0 && text.slice(span.start, span.end) === expected;
  });
}

export function applySpans(text: string, spans: CorrectionSpan[]): string {
  let next = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, span.start)}${span.replacement}${next.slice(span.end)}`;
  }
  return next;
}

export function caretAfterSpans(offset: number, spans: CorrectionSpan[]): number {
  let next = offset;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const delta = span.replacement.length - (span.end - span.start);
    if (next >= span.end) next += delta;
    else if (next > span.start) next = span.start + span.replacement.length;
  }
  return Math.max(0, next);
}

export function selectPopupSpan(
  text: string,
  originalText: string,
  spans: CorrectionSpan[]
): (CorrectionSpan & { original: string }) | null {
  const match = matchingSpans(text, originalText, spans)[0];
  if (!match) return null;
  return { ...match, original: originalText.slice(match.start, match.end) };
}

/**
 * What Accept / auto-accept should write. Null if the live draft no longer
 * holds the span (the author typed through it).
 */
export function acceptedCorrection(opts: {
  suggestion: Pick<GrammarSuggestion, "blockId" | "text" | "spans"> | null;
  liveText: string;
  caret: number;
}): { blockId: string; nextText: string; caret: number } | null {
  if (!opts.suggestion) return null;
  const spans = matchingSpans(opts.liveText, opts.suggestion.text, opts.suggestion.spans);
  if (spans.length === 0) return null;
  const span = spans[0];
  return {
    blockId: opts.suggestion.blockId,
    nextText: applySpans(opts.liveText, [span]),
    caret: caretAfterSpans(opts.caret, [span]),
  };
}

export function suggestionKey(suggestion: Pick<GrammarSuggestion, "chapterId" | "blockId" | "text" | "spans">): string {
  const span = suggestion.spans[0];
  return `${suggestion.chapterId}:${suggestion.blockId}:${suggestion.text}:${span?.start ?? ""}:${span?.end ?? ""}:${span?.replacement ?? ""}`;
}

export function autoAcceptProgress(shownAt: number, durationMs: number, now: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (now - shownAt) / durationMs));
}

/** Pin a callout to the line that still holds `start` (from Text onTextLayout). */
export function spanAnchorFromLines(
  lines: TextLineMetrics[],
  start: number,
  end: number
): SpanAnchor | null {
  if (lines.length === 0 || start < 0 || end <= start) return null;
  let offset = 0;
  for (const line of lines) {
    const len = line.text.length;
    const lineEnd = offset + len;
    if (start < lineEnd) {
      const local = Math.max(0, Math.min(len, start - offset));
      const frac = len === 0 ? 0 : local / len;
      const spanEnd = Math.min(end, lineEnd);
      const spanChars = Math.max(0, spanEnd - Math.max(start, offset));
      const widthFrac = len === 0 ? 0 : spanChars / len;
      return {
        x: line.x + frac * line.width,
        y: line.y,
        width: Math.max(8, widthFrac * line.width),
        height: line.height || 22,
      };
    }
    offset = lineEnd;
  }
  const last = lines[lines.length - 1];
  return {
    x: last.x + last.width,
    y: last.y,
    width: 8,
    height: last.height || 22,
  };
}

export function caretAnchorFromLines(
  lines: TextLineMetrics[],
  offset: number
): Pick<SpanAnchor, "x" | "y" | "height"> | null {
  if (lines.length === 0 || offset < 0) return null;
  let pos = 0;
  for (const line of lines) {
    const len = line.text.length;
    const lineEnd = pos + len;
    if (offset <= lineEnd) {
      const local = Math.max(0, Math.min(len, offset - pos));
      const frac = len === 0 ? 0 : local / len;
      return {
        x: line.x + frac * line.width,
        y: line.y,
        height: line.height || 22,
      };
    }
    pos = lineEnd;
  }
  const last = lines[lines.length - 1];
  return { x: last.x + last.width, y: last.y, height: last.height || 22 };
}

export function estimateSpanAnchor(opts: {
  text: string;
  start: number;
  end: number;
  width: number;
  fontSize: number;
  lineHeight: number;
}): SpanAnchor {
  const avg = Math.max(1, opts.fontSize * 0.52);
  const cols = Math.max(1, Math.floor(opts.width / avg) || 1);
  const line = Math.floor(opts.start / cols);
  const col = opts.start % cols;
  const spanEnd = Math.min(opts.end, (line + 1) * cols);
  return {
    x: col * avg,
    y: line * opts.lineHeight,
    width: Math.max(8, (spanEnd - opts.start) * avg),
    height: opts.lineHeight,
  };
}

export function placeCallout(opts: {
  anchor: SpanAnchor;
  popup: { width: number; height: number };
  blockWidth: number;
  gap?: number;
}): { top: number; left: number } {
  const gap = opts.gap ?? 6;
  const above = opts.anchor.y >= opts.popup.height + gap;
  const top = above
    ? opts.anchor.y - opts.popup.height - gap
    : opts.anchor.y + opts.anchor.height + gap;
  const maxLeft = Math.max(0, opts.blockWidth - opts.popup.width);
  return { top, left: Math.min(maxLeft, Math.max(0, opts.anchor.x)) };
}

/**
 * Idle/terminator grammar loop. Never blocks typing: a keystroke aborts that
 * block's in-flight request, and a stale focused-block span is dropped.
 * Auto-accept is armed here (not on popup mount) so a row remount cannot cancel it.
 */
export class GrammarLoop {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inflight = new Map<string, AbortController>();
  private drafts = new Map<string, string>();
  private composing = new Set<string>();
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  suggestion: GrammarSuggestion | null = null;

  constructor(
    private request: GrammarRequest,
    private notify: (suggestion: GrammarSuggestion | null) => void,
    private idleMs = GRAMMAR_IDLE_MS,
    private onAutoAccept?: () => void,
    private now: () => number = Date.now
  ) {}

  setSuggestion(suggestion: (Omit<GrammarSuggestion, "shownAt"> & { shownAt?: number }) | null): void {
    if (this.suggestion === suggestion) return;
    let next: GrammarSuggestion | null = null;
    if (suggestion) {
      const shownAt =
        this.suggestion && suggestionKey(this.suggestion) === suggestionKey(suggestion)
          ? this.suggestion.shownAt
          : (suggestion.shownAt ?? this.now());
      next = { ...suggestion, shownAt };
    }
    this.suggestion = next;
    this.notify(next);
    this.armAutoAccept();
  }

  noteDraft(blockId: string, text: string): void {
    this.drafts.set(blockId, text);
  }

  draftOf(blockId: string): string | undefined {
    return this.drafts.get(blockId);
  }

  setComposing(blockId: string, composing: boolean): void {
    if (composing) {
      this.composing.add(blockId);
      const controller = this.inflight.get(blockId);
      if (controller) {
        controller.abort();
        this.inflight.delete(blockId);
      }
      return;
    }
    this.composing.delete(blockId);
  }

  cancelBlock(blockId: string): void {
    const timer = this.timers.get(blockId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(blockId);
    }
    const controller = this.inflight.get(blockId);
    if (controller) {
      controller.abort();
      this.inflight.delete(blockId);
    }
  }

  cancelAll(): void {
    for (const blockId of [...this.timers.keys(), ...this.inflight.keys()]) {
      this.cancelBlock(blockId);
    }
  }

  forgetBlock(blockId: string): void {
    this.cancelBlock(blockId);
    this.drafts.delete(blockId);
    this.composing.delete(blockId);
    if (this.suggestion?.blockId === blockId) this.setSuggestion(null);
  }

  dropIfStale(blockId: string, text: string): void {
    const suggestion = this.suggestion;
    if (!suggestion || suggestion.blockId !== blockId) return;
    if (matchingSpans(text, suggestion.text, suggestion.spans).length === 0) {
      this.setSuggestion(null);
    }
  }

  acceptableSpans(blockId: string, currentText: string): CorrectionSpan[] {
    const suggestion = this.suggestion;
    if (!suggestion || suggestion.blockId !== blockId) return [];
    return matchingSpans(currentText, suggestion.text, suggestion.spans);
  }

  onKeystroke(opts: {
    chapterId: string;
    blockId: string;
    text: string;
    revision: number;
    autoCorrect: boolean;
  }): void {
    const { blockId, text } = opts;
    this.noteDraft(blockId, text);
    this.cancelBlock(blockId);
    this.dropIfStale(blockId, text);
    if (!opts.autoCorrect) {
      this.setSuggestion(null);
      return;
    }
    if (
      !shouldRequestCorrect({
        autoCorrect: true,
        composing: this.composing.has(blockId),
        text,
      })
    ) {
      return;
    }
    if (endedOnSentence(text)) {
      void this.run(opts);
      return;
    }
    this.timers.set(
      blockId,
      setTimeout(() => {
        this.timers.delete(blockId);
        const latest = this.drafts.get(blockId) ?? text;
        if (
          !shouldRequestCorrect({
            autoCorrect: true,
            composing: this.composing.has(blockId),
            text: latest,
          })
        ) {
          return;
        }
        void this.run({ ...opts, text: latest });
      }, this.idleMs)
    );
  }

  dispose(): void {
    this.cancelAll();
    this.setSuggestion(null);
  }

  private armAutoAccept(): void {
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = undefined;
    }
    if (!this.suggestion || !this.onAutoAccept) return;
    const wait = Math.max(0, GRAMMAR_AUTO_ACCEPT_MS - (this.now() - this.suggestion.shownAt));
    this.autoTimer = setTimeout(() => {
      this.autoTimer = undefined;
      this.onAutoAccept?.();
    }, wait);
  }

  private async run(opts: {
    chapterId: string;
    blockId: string;
    text: string;
    revision: number;
  }): Promise<void> {
    const controller = new AbortController();
    this.inflight.get(opts.blockId)?.abort();
    this.inflight.set(opts.blockId, controller);
    try {
      const result = await this.request({ ...opts, signal: controller.signal });
      if (controller.signal.aborted) return;
      this.inflight.delete(opts.blockId);
      const live = this.drafts.get(opts.blockId) ?? opts.text;
      const spans = matchingSpans(live, opts.text, result.spans ?? []);
      if (spans.length === 0) return;
      this.setSuggestion({
        chapterId: opts.chapterId,
        blockId: opts.blockId,
        text: opts.text,
        spans,
      });
    } catch {
      if (!controller.signal.aborted) this.inflight.delete(opts.blockId);
    }
  }
}
