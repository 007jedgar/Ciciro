import { describe, expect, it } from "vitest";
import {
  applyDictationCommands,
  dictationParts,
  getSpeechRecognition,
  isFatalSpeechError,
  prepareDictation,
} from "@/lib/dictation";

describe("getSpeechRecognition", () => {
  it("returns null when the browser has no recognizer", () => {
    expect(getSpeechRecognition({})).toBeNull();
    expect(getSpeechRecognition(undefined)).toBeNull();
  });

  it("prefers the standard name and falls back to the webkit prefix", () => {
    class Std {}
    class Webkit {}
    expect(getSpeechRecognition({ SpeechRecognition: Std, webkitSpeechRecognition: Webkit })).toBe(Std);
    expect(getSpeechRecognition({ webkitSpeechRecognition: Webkit })).toBe(Webkit);
  });
});

describe("isFatalSpeechError", () => {
  it("treats routine silence as recoverable and permission loss as fatal", () => {
    expect(isFatalSpeechError("no-speech")).toBe(false);
    expect(isFatalSpeechError("aborted")).toBe(false);
    expect(isFatalSpeechError("not-allowed")).toBe(true);
    expect(isFatalSpeechError("audio-capture")).toBe(true);
  });
});

describe("applyDictationCommands", () => {
  it("turns spoken layout words into breaks in English", () => {
    expect(applyDictationCommands("she left new paragraph he stayed", "en-US")).toBe(
      "she left\n\nhe stayed"
    );
    expect(applyDictationCommands("one new line two", "en")).toBe("one\ntwo");
    expect(applyDictationCommands("is that so question mark", "en-GB")).toBe("is that so?");
  });

  it("leaves other languages alone", () => {
    expect(applyDictationCommands("new paragraph", "fr-FR")).toBe("new paragraph");
  });
});

describe("prepareDictation", () => {
  it("capitalizes at the start of a paragraph and after a sentence end", () => {
    expect(prepareDictation("the door opened", "")).toBe("The door opened");
    expect(prepareDictation("then it closed", "It opened.")).toBe(" Then it closed");
  });

  it("joins mid-sentence with a single space and no capital", () => {
    expect(prepareDictation("and waited", "She stood")).toBe(" and waited");
    expect(prepareDictation("and waited", "She stood ")).toBe("and waited");
  });

  it("does not put a space before punctuation", () => {
    expect(prepareDictation("? really", "Who", "en")).toBe("? really");
  });

  it("returns an empty string for silence", () => {
    expect(prepareDictation("   ", "abc")).toBe("");
  });

  it("starts a spoken paragraph with a capital", () => {
    expect(prepareDictation("new paragraph next morning", "It ended")).toBe("\n\nNext morning");
  });
});

describe("dictationParts", () => {
  it("splits text runs from paragraph and line breaks", () => {
    expect(dictationParts("a\n\nb\nc")).toEqual([
      { type: "text", text: "a" },
      { type: "paragraph" },
      { type: "text", text: "b" },
      { type: "break" },
      { type: "text", text: "c" },
    ]);
  });
});
