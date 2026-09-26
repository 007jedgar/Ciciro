import { useCallback, useEffect, useRef, useState } from "react";

// Speech recognition comes from expo-speech-recognition, a native module that
// Expo Go does not ship. It is loaded lazily so the app still runs there, and
// dictation simply stays hidden.

type Subscription = { remove: () => void };

type SpeechModule = {
  isRecognitionAvailable: () => boolean;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    addsPunctuation: boolean;
  }) => void;
  stop: () => void;
  abort: () => void;
  addListener: (
    event: string,
    listener: (event: never) => void,
  ) => Subscription;
};

let cached: SpeechModule | null | undefined;

export function getSpeechModule(): SpeechModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-speech-recognition") as {
      ExpoSpeechRecognitionModule: SpeechModule;
    };
    cached = mod.ExpoSpeechRecognitionModule.isRecognitionAvailable()
      ? mod.ExpoSpeechRecognitionModule
      : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test hook: forget the cached module lookup. */
export function resetSpeechModule() {
  cached = undefined;
}

type ResultEvent = { isFinal: boolean; results: { transcript: string }[] };
type ErrorEvent = { error: string; message?: string };

export type DictationError = "denied" | "unavailable" | "language" | "network";

/** Errors after which listening again would just fail again. */
const FATAL: Record<string, DictationError> = {
  "not-allowed": "denied",
  "service-not-allowed": "denied",
  "audio-capture": "unavailable",
  "language-not-supported": "language",
  network: "network",
};

/** What the recognizer reports during an ordinary pause; listening carries on. */
const ROUTINE = new Set(["no-speech", "aborted", "speech-timeout"]);

/** Other errors in a row, with no words heard between them, before giving up. */
const MAX_ERROR_RESTARTS = 3;

export function useDictation({
  lang,
  onPhrase,
  onError,
}: {
  lang: string;
  onPhrase: (text: string) => void;
  onError?: (error: DictationError) => void;
}) {
  const [available] = useState(() => getSpeechModule() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const wanted = useRef(false);
  const failures = useRef(0);
  const onPhraseRef = useRef(onPhrase);
  onPhraseRef.current = onPhrase;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const langRef = useRef(lang);
  langRef.current = lang;

  const begin = useCallback(() => {
    getSpeechModule()?.start({
      lang: langRef.current,
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
    });
  }, []);

  const stop = useCallback(() => {
    wanted.current = false;
    setListening(false);
    setInterim("");
    try {
      getSpeechModule()?.stop();
    } catch {
      // already stopped
    }
  }, []);

  useEffect(() => {
    const mod = getSpeechModule();
    if (!mod) return;
    const subs = [
      mod.addListener("result", ((event: ResultEvent) => {
        failures.current = 0;
        const transcript = event.results[0]?.transcript ?? "";
        if (event.isFinal) {
          setInterim("");
          if (transcript.trim()) onPhraseRef.current(transcript);
        } else {
          setInterim(transcript);
        }
      }) as (event: never) => void),
      mod.addListener("error", ((event: ErrorEvent) => {
        if (ROUTINE.has(event.error)) return;
        const fatal = FATAL[event.error];
        failures.current += 1;
        if (!fatal && failures.current < MAX_ERROR_RESTARTS) return;
        wanted.current = false;
        setListening(false);
        setInterim("");
        onErrorRef.current?.(fatal ?? "unavailable");
      }) as (event: never) => void),
      mod.addListener("end", (() => {
        // The system ends a session after a stretch of silence. Keep listening
        // until the writer turns dictation off.
        if (wanted.current) {
          try {
            begin();
          } catch {
            stop();
          }
          return;
        }
        setListening(false);
        setInterim("");
      }) as (event: never) => void),
    ];
    return () => {
      subs.forEach((sub) => sub.remove());
      if (wanted.current) {
        wanted.current = false;
        try {
          mod.abort();
        } catch {
          // already stopped
        }
      }
    };
  }, [begin, stop]);

  const start = useCallback(async () => {
    const mod = getSpeechModule();
    if (!mod) {
      onErrorRef.current?.("unavailable");
      return;
    }
    const permission = await mod.requestPermissionsAsync();
    if (!permission.granted) {
      onErrorRef.current?.("denied");
      return;
    }
    wanted.current = true;
    failures.current = 0;
    setListening(true);
    try {
      begin();
    } catch {
      stop();
      onErrorRef.current?.("unavailable");
    }
  }, [begin, stop]);

  const toggle = useCallback(() => {
    if (wanted.current) stop();
    else void start();
  }, [start, stop]);

  return { available, listening, interim, toggle, stop };
}
