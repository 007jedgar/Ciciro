import { describe, expect, it } from "vitest";
import { attributeSave, wordDiff } from "@/lib/gamification/attribution";

function words(n: number, prefix = "w"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
}

describe("wordDiff", () => {
  it("counts added and removed tokens, not only a net wordCount delta", () => {
    const prev = words(3, "old");
    const next = words(3, "new");
    expect(wordDiff(prev, next)).toEqual({ added: 3, removed: 3 });
  });

  it("counts a pure append", () => {
    expect(wordDiff("hello there", "hello there friend")).toEqual({
      added: 1,
      removed: 0,
    });
  });
});

describe("attributeSave", () => {
  it("credits small manuscript growth as human-typed", () => {
    const result = attributeSave({
      prevText: "Once upon",
      nextText: "Once upon a time",
      chairMinutes: 5,
      humanTypedAlreadyToday: 0,
    });
    expect(result.humanTyped).toBe(2);
    expect(result.aiInserted).toBe(0);
    expect(result.pasted).toBe(0);
  });

  it("does not count chat", () => {
    const result = attributeSave({
      prevText: "",
      nextText: words(80),
      source: "chat",
      chairMinutes: 30,
      humanTypedAlreadyToday: 0,
    });
    expect(result).toMatchObject({
      addedWords: 0,
      humanTyped: 0,
      aiInserted: 0,
    });
  });

  it("marks autowrite and draft inserts as AI", () => {
    const draft = attributeSave({
      prevText: "",
      nextText: words(40),
      source: "draft_insert",
      chairMinutes: 20,
      humanTypedAlreadyToday: 0,
    });
    const auto = attributeSave({
      prevText: "",
      nextText: words(40),
      source: "autowrite",
      chairMinutes: 20,
      humanTypedAlreadyToday: 0,
    });
    expect(draft.aiInserted).toBe(40);
    expect(draft.humanTyped).toBe(0);
    expect(auto.aiInserted).toBe(40);
  });

  it("marks editor mutations separately", () => {
    const result = attributeSave({
      prevText: "alpha",
      nextText: "alpha beta gamma",
      source: "editor_mutate",
      chairMinutes: 10,
      humanTypedAlreadyToday: 0,
    });
    expect(result.editorMutated).toBe(2);
    expect(result.humanTyped).toBe(0);
  });

  it("treats a large paste dump as pasted, not Prose", () => {
    const result = attributeSave({
      prevText: "",
      nextText: words(100),
      inputMeta: { pastedChars: 500 },
      chairMinutes: 30,
      humanTypedAlreadyToday: 0,
    });
    expect(result.pasted).toBeGreaterThan(40);
    expect(result.humanTyped).toBe(0);
  });

  it("caps human-typed words at about 80 WPM vs chair time", () => {
    const result = attributeSave({
      prevText: "",
      nextText: words(400),
      chairMinutes: 1,
      humanTypedAlreadyToday: 0,
    });
    expect(result.humanTyped).toBe(80);
    expect(result.uncappedIgnored).toBe(320);
  });

  it("does not let already-credited words exceed the daily cap", () => {
    const result = attributeSave({
      prevText: "",
      nextText: words(50),
      chairMinutes: 1,
      humanTypedAlreadyToday: 80,
    });
    expect(result.humanTyped).toBe(0);
    expect(result.uncappedIgnored).toBe(50);
  });
});
