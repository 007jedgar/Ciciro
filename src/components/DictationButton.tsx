"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpeechRecognition,
  isFatalSpeechError,
  speechErrorMessage,
  type SpeechRecognitionCtor,
  type SpeechRecognitionLike,
} from "@/lib/dictation";
import { MOTION_MS, usePresence } from "@/lib/motion";

/** How long an error stays before it dismisses itself. */
export const DICTATION_ERROR_MS = 5000;

type Props = {
  /** Called with each finished phrase. */
  onPhrase: (text: string, lang: string) => void;
  /** Changing this stops listening (e.g. the writer switched chapters). */
  resetKey?: string;
};

/**
 * Toggle for dictation. Renders nothing where the browser has no speech
 * recognition, so unsupported browsers never see a dead control.
 */
export default function DictationButton({ onPhrase, resetKey }: Props) {
  const [Ctor, setCtor] = useState<SpeechRecognitionCtor | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The last message stays on screen for the exit animation after `error` clears.
  const shownError = useRef("");
  if (error) shownError.current = error;
  const errorPresence = usePresence(Boolean(error), MOTION_MS.popoverOut);
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const wanted = useRef(false);
  const onPhraseRef = useRef(onPhrase);
  onPhraseRef.current = onPhrase;

  useEffect(() => {
    setCtor(() => getSpeechRecognition(window));
  }, []);

  const stop = useCallback(() => {
    wanted.current = false;
    const rec = recognizer.current;
    recognizer.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // already stopped
      }
    }
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    const rec = new Ctor();
    const lang = navigator.language || "en-US";
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let live = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) onPhraseRef.current(transcript, lang);
        else live += transcript;
      }
      setInterim(live);
    };
    rec.onerror = (event) => {
      // "no-speech" and "aborted" are routine; onend restarts the session.
      if (isFatalSpeechError(event.error) || event.error === "network") {
        setError(speechErrorMessage(event.error));
        stop();
      }
    };
    rec.onend = () => {
      // Browsers end a session after a stretch of silence. Keep listening
      // until the writer turns dictation off.
      if (!wanted.current || recognizer.current !== rec) return;
      try {
        rec.start();
      } catch {
        stop();
      }
    };
    recognizer.current = rec;
    wanted.current = true;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      stop();
    }
  }, [Ctor, stop]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), DICTATION_ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    stop();
  }, [resetKey, stop]);

  if (!Ctor) return null;

  return (
    <span className="dictation">
      <button
        type="button"
        className={`btn small dictation-mic${listening ? " primary listening" : ""}`}
        aria-pressed={listening}
        // Keep the editor's caret while the button is pressed.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (listening ? stop() : start())}
        title={
          listening
            ? "Stop dictating"
            : 'Speak to write at the caret. Say "new paragraph" or "new line" to break.'
        }
      >
        {listening ? "Listening..." : "Dictate"}
      </button>
      {listening && interim && (
        <span className="dictation-interim" aria-live="polite">
          {interim}
        </span>
      )}
      {errorPresence.mounted && (
        <div
          className="dictation-error"
          role="alert"
          data-state={errorPresence.state}
        >
          <span>{shownError.current}</span>
          <button
            type="button"
            className="dictation-error-close"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
          <span
            className="dictation-error-bar"
            aria-hidden="true"
            style={{ animationDuration: `${DICTATION_ERROR_MS}ms` }}
          />
        </div>
      )}
    </span>
  );
}
