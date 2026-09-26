"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { EditorHandle } from "@/components/Editor";
import { RATE_STEPS, SpeechReader, type ReaderState } from "@/lib/tts";
import { setTtsPrefs, useTtsPrefs } from "@/lib/tts-prefs";

function sortVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
  const rank = (v: SpeechSynthesisVoice) => (v.lang.toLowerCase().startsWith(lang) ? 0 : 1);
  return [...voices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Read the selection (or the whole chapter) aloud with the browser's speech
 * synthesis, highlighting the sentence being read. `resetKey` stops playback
 * when the chapter changes.
 */
export default function ReadAloud({
  editorRef,
  resetKey,
  disabled,
}: {
  editorRef: RefObject<EditorHandle | null>;
  resetKey: string;
  disabled?: boolean;
}) {
  const prefs = useTtsPrefs();
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ReaderState>("idle");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [progress, setProgress] = useState({ index: 0, total: 0, selection: false });
  const readerRef = useRef<SpeechReader<SpeechSynthesisUtterance> | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  voicesRef.current = voices;

  const voiceFor = useCallback(
    (uri: string | null) => voicesRef.current.find((v) => v.voiceURI === uri) ?? null,
    []
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    const synth = window.speechSynthesis;
    const load = () => setVoices(sortVoices(synth.getVoices()));
    load();
    synth.addEventListener("voiceschanged", load);
    const reader = new SpeechReader<SpeechSynthesisUtterance>(
      synth,
      (text) => new SpeechSynthesisUtterance(text),
      (next, index) => {
        setState(next);
        setProgress((p) => ({ ...p, index }));
        editorRef.current?.highlightReadAloud(next === "idle" ? null : index);
      }
    );
    readerRef.current = reader;
    return () => {
      synth.removeEventListener("voiceschanged", load);
      reader.stop();
      readerRef.current = null;
    };
  }, [editorRef]);

  // Chapter switch or leaving the prose view ends the reading.
  useEffect(() => {
    readerRef.current?.stop();
  }, [resetKey, disabled]);

  const play = useCallback(() => {
    const reader = readerRef.current;
    const handle = editorRef.current;
    if (!reader || !handle) return;
    if (reader.current.state === "paused") {
      reader.resume();
      return;
    }
    const { sentences, selection } = handle.beginReadAloud();
    setProgress({ index: 0, total: sentences.length, selection });
    reader.start(
      sentences.map((s) => s.text),
      {
        rate: prefs.rate,
        voice: voiceFor(prefs.voiceURI),
        textAt: (index) => editorRef.current?.readAloudSentence(index)?.text ?? null,
      }
    );
  }, [editorRef, prefs.rate, prefs.voiceURI, voiceFor]);

  const stop = useCallback(() => readerRef.current?.stop(), []);

  if (!supported) return null;

  const active = state !== "idle";
  const panel = open ? (
    <div className="read-aloud" role="region" aria-label="Read aloud">
      <div className="read-aloud-row">
        {state === "playing" ? (
          <button type="button" className="btn small primary" onClick={() => readerRef.current?.pause()}>
            Pause
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={play}>
            {state === "paused" ? "Resume" : "Play"}
          </button>
        )}
        <button type="button" className="btn small" onClick={stop} disabled={!active}>
          Stop
        </button>
        <span className="read-aloud-status" aria-live="polite">
          {active
            ? `${progress.selection ? "Selection" : "Chapter"}: sentence ${progress.index + 1} of ${progress.total}`
            : "Reads your selection, or the whole chapter"}
        </span>
        <button
          type="button"
          className="btn ghost small"
          aria-label="Close read aloud"
          onClick={() => {
            stop();
            setOpen(false);
          }}
        >
          &times;
        </button>
      </div>
      <div className="read-aloud-row">
        <label>
          Speed{" "}
          <select
            value={prefs.rate}
            onChange={(e) => {
              const rate = Number(e.target.value);
              setTtsPrefs({ rate });
              readerRef.current?.setRate(rate);
            }}
          >
            {RATE_STEPS.map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>
        <label>
          Voice{" "}
          <select
            value={prefs.voiceURI ?? ""}
            onChange={(e) => {
              const voiceURI = e.target.value || null;
              setTtsPrefs({ voiceURI });
              readerRef.current?.setVoice(voiceFor(voiceURI));
            }}
          >
            <option value="">Default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className={`btn small${active ? " primary" : ""}`}
        aria-pressed={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Hear your selection or chapter read aloud, handy for line edits"
      >
        Listen
      </button>
      {panel && createPortal(panel, document.body)}
    </>
  );
}
