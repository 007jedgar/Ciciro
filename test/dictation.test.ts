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
    expect(
      getSpeechRecognition({
        SpeechRecognition: Std,
        webkitSpeechRecognition: Webkit,
      }),
    ).toBe(Std);
    expect(getSpeechRecognition({ webkitSpeechRecognition: Webkit })).toBe(
      Webkit,
    );
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
  it("acts on a command spoken on its own in English", () => {
    expect(applyDictationCommands("new paragraph", "en-US")).toBe("\n\n");
    expect(applyDictationCommands(" New line. ", "en")).toBe("\n");
    expect(applyDictationCommands("Full stop", "en-GB")).toBe(".");
    expect(applyDictationCommands("question mark", "en")).toBe("?");
  });

  it("keeps command words inside a longer phrase as spoken", () => {
    for (const phrase of [
      "The car came to a full stop",
      "a new line of work",
      "the colon",
    ])
      expect(applyDictationCommands(phrase, "en-US")).toBe(phrase);
  });

  it("leaves other languages alone", () => {
    expect(applyDictationCommands("new paragraph", "fr-FR")).toBe(
      "new paragraph",
    );
  });
});

describe("prepareDictation", () => {
  it("capitalizes at the start of a paragraph and after a sentence end", () => {
    expect(prepareDictation("the door opened", "")).toBe("The door opened");
    expect(prepareDictation("then it closed", "It opened.")).toBe(
      " Then it closed",
    );
  });

  it("joins mid-sentence with a single space and no capital", () => {
    expect(prepareDictation("and waited", "She stood")).toBe(" and waited");
    expect(prepareDictation("and waited", "She stood ")).toBe("and waited");
  });

  it("does not put a space before punctuation", () => {
    expect(prepareDictation("? really", "Who", "en")).toBe("? really");
  });

  it("keeps prose that contains a command word", () => {
    expect(prepareDictation("came to a full stop", "The car", "en")).toBe(
      " came to a full stop",
    );
  });

  it("returns an empty string for silence", () => {
    expect(prepareDictation("   ", "abc")).toBe("");
  });

  it("turns a lone paragraph command into a break without a joining space", () => {
    expect(prepareDictation("new paragraph", "It ended", "en")).toBe("\n\n");
    expect(prepareDictation("full stop", "It ended", "en")).toBe(".");
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
