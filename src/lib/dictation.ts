// Dictation: browser speech recognition feeding text into the editor at the
// caret. Everything here is pure so the recognizer plumbing stays thin.

export type SpeechAlternative = { transcript: string };
export type SpeechResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative;
};
export type SpeechResultEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
};
export type SpeechErrorEvent = { error: string };

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The browser's recognizer, or null where dictation is not available. */
export function getSpeechRecognition(
  win: object | undefined,
): SpeechRecognitionCtor | null {
  if (!win) return null;
  const w = win as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as SpeechRecognitionCtor) : null;
}

/** Errors that mean listening again would just fail again. */
export function isFatalSpeechError(error: string): boolean {
  return (
    error === "not-allowed" ||
    error === "service-not-allowed" ||
    error === "audio-capture" ||
    error === "language-not-supported"
  );
}

export function speechErrorMessage(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in your browser's site settings to dictate.";
    case "audio-capture":
      return "No microphone was found.";
    case "language-not-supported":
      return "Dictation isn't available for this language in your browser.";
    case "network":
      return "Dictation needs a network connection in this browser.";
    default:
      return "Dictation stopped unexpectedly.";
  }
}

const COMMANDS = new Map<string, string>([
  ["new paragraph", "\n\n"],
  ["new line", "\n"],
  ["question mark", "?"],
  ["exclamation mark", "!"],
  ["exclamation point", "!"],
  ["full stop", "."],
  ["semicolon", ";"],
  ["colon", ":"],
]);

/**
 * Spoken layout and punctuation ("new paragraph", "question mark"), English
 * only. A command counts only when it is the whole phrase, so prose such as
 * "came to a full stop" stays as spoken.
 */
export function applyDictationCommands(text: string, lang: string): string {
  if (!/^en(?:$|[-_])/i.test(lang)) return text;
  const phrase = text
    .trim()
    .replace(/[.,!?]+$/, "")
    .trim()
    .toLowerCase();
  return COMMANDS.get(phrase) ?? text;
}

/**
 * Shape a final transcript for the spot it lands in. `before` is the text
 * just ahead of the caret in its paragraph (empty at a paragraph start) and
 * `after` the text just behind it. Adds the joining spaces and capitalizes a
 * sentence start.
 */
export function prepareDictation(
  raw: string,
  before: string,
  lang = "en",
  after = "",
): string {
  let text = applyDictationCommands(raw.trim(), lang);
  if (!text) return "";
  const startsSentence =
    before.trim() === "" || /[.!?…]["'”’)]*\s*$/.test(before);
  if (startsSentence && /^[a-z]/.test(text))
    text = text[0].toUpperCase() + text.slice(1);
  text = text.replace(
    /(\n+)([a-z])/g,
    (_m, nl: string, c: string) => nl + c.toUpperCase(),
  );
  const needsSpace =
    before !== "" &&
    !/\s$/.test(before) &&
    !text.startsWith("\n") &&
    !/^[.,;:!?)\]”’]/.test(text);
  const needsTrailingSpace =
    /^[\p{L}\p{N}]/u.test(after) && !/\s$/.test(text);
  return `${needsSpace ? " " : ""}${text}${needsTrailingSpace ? " " : ""}`;
}

export type DictationPart =
  { type: "text"; text: string } | { type: "paragraph" } | { type: "break" };

/** Break dictated text into text runs, paragraph breaks (blank line) and line breaks. */
export function dictationParts(text: string): DictationPart[] {
  const parts: DictationPart[] = [];
  for (const piece of text.split(/(\n{2,}|\n)/)) {
    if (piece === "") continue;
    if (piece.startsWith("\n"))
      parts.push(piece.length > 1 ? { type: "paragraph" } : { type: "break" });
    else parts.push({ type: "text", text: piece });
  }
  return parts;
}
