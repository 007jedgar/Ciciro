import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampRate, splitSentences, SpeechReader, type SynthLike, type UtteranceLike } from "@/lib/tts";

function texts(input: string) {
  return splitSentences(input).map((r) => input.slice(r.start, r.end));
}

describe("splitSentences", () => {
  it("splits on terminators and keeps closing quotes", () => {
    expect(texts('She ran. "Stop!" he cried. Why?')).toEqual(["She ran.", '"Stop!"', "he cried.", "Why?"]);
  });

  it("does not split on common abbreviations or decimals", () => {
    expect(texts("Dr. Lee met Mr. Park at 3.5 miles. Then left.")).toEqual([
      "Dr. Lee met Mr. Park at 3.5 miles.",
      "Then left.",
    ]);
  });

  it("keeps a trailing fragment and skips blanks", () => {
    expect(texts("One.  \n Two without end")).toEqual(["One.", "Two without end"]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("returns offsets into the original text", () => {
    const [a, b] = splitSentences("Hi there. Bye.");
    expect([a.start, a.end, b.start, b.end]).toEqual([0, 9, 10, 14]);
  });
});

describe("clampRate", () => {
  it("bounds and defaults", () => {
    expect(clampRate(9)).toBe(2);
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate("x")).toBe(1);
    expect(clampRate(1.25)).toBe(1.25);
  });
});

describe("SpeechReader", () => {
  let spoken: UtteranceLike[];
  let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
  let events: Array<[string, number]>;
  let reader: SpeechReader;

  beforeEach(() => {
    spoken = [];
    events = [];
    synth = {
      speak: vi.fn((u: UtteranceLike) => spoken.push(u)),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };
    reader = new SpeechReader(
      synth as unknown as SynthLike,
      (text) => ({ text, rate: 1, voice: null, onend: null, onerror: null }),
      (state, index) => events.push([state, index])
    );
  });

  const last = () => spoken[spoken.length - 1];

  it("reads sentences in order and returns to idle", () => {
    reader.start(["A.", "B."], { rate: 1.5, voice: "v" });
    expect(last().text).toBe("A.");
    expect(last().rate).toBe(1.5);
    expect(last().voice).toBe("v");
    last().onend!({});
    expect(last().text).toBe("B.");
    expect(reader.current).toEqual({ state: "playing", index: 1 });
    last().onend!({});
    expect(reader.current.state).toBe("idle");
  });

  it("pauses, resumes the same sentence, and stops", () => {
    reader.start(["A.", "B."]);
    last().onend!({});
    reader.pause();
    expect(synth.pause).toHaveBeenCalled();
    expect(reader.current.state).toBe("paused");
    reader.resume();
    expect(last().text).toBe("B.");
    expect(reader.current.state).toBe("playing");
    reader.stop();
    expect(reader.current).toEqual({ state: "idle", index: 0 });
  });

  it("unpauses the engine before speaking again after a pause", () => {
    let paused = false;
    const heard: string[] = [];
    const engine: SynthLike = {
      speak: (u) => {
        if (!paused) heard.push(u.text);
      },
      cancel: () => {},
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
    };
    const r = new SpeechReader(engine, (text) => ({ text, rate: 1, voice: null, onend: null, onerror: null }), () => {});
    r.start(["A.", "B."]);
    r.pause();
    r.resume();
    expect(heard).toEqual(["A.", "A."]);
    r.pause();
    r.stop();
    r.start(["C."]);
    expect(heard).toEqual(["A.", "A.", "C."]);
  });

  it("reports each sentence advance once", () => {
    reader.start(["A.", "B."]);
    events.length = 0;
    last().onend!({});
    expect(events).toEqual([["playing", 1]]);
  });

  it("speaks the live text of each segment and skips deleted ones", () => {
    const live: Array<string | null> = ["A.", "B.", "C."];
    reader.start(["A.", "B.", "C."], { textAt: (i) => live[i] });
    live[1] = null;
    live[2] = "C edited.";
    last().onend!({});
    expect(last().text).toBe("C edited.");
    expect(reader.current).toEqual({ state: "playing", index: 2 });
    live[0] = "";
    reader.stop();
    reader.start(["A.", "B."], { textAt: () => null });
    expect(reader.current.state).toBe("idle");
  });

  it("ignores stale end events after stop", () => {
    reader.start(["A.", "B."]);
    const first = last();
    reader.stop();
    first.onend!({});
    expect(spoken).toHaveLength(1);
  });

  it("restarts the current sentence when speed or voice changes", () => {
    reader.start(["A.", "B."]);
    reader.setRate(2);
    expect(spoken).toHaveLength(2);
    expect(last().text).toBe("A.");
    expect(last().rate).toBe(2);
    reader.setVoice("x");
    expect(last().voice).toBe("x");
  });

  it("goes idle on a real error but not on our own cancel", () => {
    reader.start(["A."]);
    last().onerror!({ error: "canceled" });
    expect(reader.current.state).toBe("playing");
    last().onerror!({ error: "synthesis-failed" });
    expect(reader.current.state).toBe("idle");
  });

  it("does nothing for empty input", () => {
    reader.start(["  ", ""]);
    expect(reader.current.state).toBe("idle");
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

describe("docSentences", () => {
  it("maps sentences to document positions across paragraphs and slices", async () => {
    const { getSchema } = await import("@tiptap/core");
    const { default: StarterKit } = await import("@tiptap/starter-kit");
    const { docSentences } = await import("@/lib/tts-doc");
    const schema = getSchema([StarterKit]);
    const p = (t: string) => schema.nodes.paragraph.create(null, schema.text(t));
    const doc = schema.nodes.doc.create(null, [p("One. Two."), p("Three")]);
    const all = docSentences(doc);
    expect(all.map((s) => s.text)).toEqual(["One.", "Two.", "Three"]);
    for (const s of all) expect(doc.textBetween(s.from, s.to)).toBe(s.text);
    const slice = docSentences(doc, { from: all[1].from, to: all[2].to });
    expect(slice.map((s) => s.text)).toEqual(["Two.", "Three"]);
  });

  it("tracks read-aloud sentences through edits and never highlights past the doc", async () => {
    const { getSchema } = await import("@tiptap/core");
    const { default: StarterKit } = await import("@tiptap/starter-kit");
    const { EditorState } = await import("@tiptap/pm/state");
    const { docSentences, highlightReadAloud, readAloudPlugin, readAloudSentence, trackReadAloud } =
      await import("@/lib/tts-doc");
    const schema = getSchema([StarterKit]);
    const p = (t: string) => schema.nodes.paragraph.create(null, schema.text(t));
    const doc = schema.nodes.doc.create(null, [p("One. Two."), p("Three")]);
    let state = EditorState.create({ doc, plugins: [readAloudPlugin()] });
    const view = {
      get state() {
        return state;
      },
      dispatch: (tr: import("@tiptap/pm/state").Transaction) => {
        state = state.apply(tr);
      },
    };
    const decorations = () =>
      (state.plugins[0].props.decorations!.call(state.plugins[0], state) as unknown as {
        find: () => Array<{ from: number; to: number }>;
      }).find();

    const sentences = docSentences(state.doc);
    trackReadAloud(view, sentences);
    highlightReadAloud(view, 2);

    view.dispatch(state.tr.insertText("Uno.", sentences[0].from, sentences[0].to));
    expect(readAloudSentence(state, 0)?.text).toBe("Uno.");
    expect(readAloudSentence(state, 2)?.text).toBe("Three");
    const [mark] = decorations();
    expect(state.doc.textBetween(mark.from, mark.to)).toBe("Three");

    view.dispatch(state.tr.delete(readAloudSentence(state, 1)!.from, state.doc.content.size - 1));
    expect(readAloudSentence(state, 1)).toBeNull();
    expect(readAloudSentence(state, 2)).toBeNull();
    expect(decorations()).toEqual([]);

    highlightReadAloud(view, 2);
    expect(decorations()).toEqual([]);
    highlightReadAloud(view, null);
    expect(readAloudSentence(state, 0)).toBeNull();
  });
});
