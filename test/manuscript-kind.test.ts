import { describe, expect, it } from "vitest";
import {
  MANUSCRIPT_KINDS,
  classifyScreenplayLines,
  cycleElement,
  elementOfHtml,
  findEntryForDate,
  journalEntryTitle,
  kindDirective,
  nextChapterTitle,
  nextElementOnEnter,
  normalizeKind,
  openingChapter,
  parseYmd,
  withElement,
} from "@/lib/manuscript-kind";
import { DRAFTER_SYSTEM, EDITOR_SYSTEM, drafterSystemFor, editorSystemFor, quickActionsFor, QUICK_ACTIONS } from "@/lib/prompts";
import * as mobileKind from "../apps/mobile/lib/manuscript-kind";

describe("manuscript kind", () => {
  it("reads anything unknown as a novel", () => {
    expect(normalizeKind(undefined)).toBe("novel");
    expect(normalizeKind("poem")).toBe("novel");
    expect(normalizeKind("screenplay")).toBe("screenplay");
  });

  it("titles a journal entry from a calendar date, whatever the timezone", () => {
    expect(journalEntryTitle("2026-09-26")).toBe("Saturday, September 26, 2026");
    expect(parseYmd("2026-02-30")).toBeNull();
    expect(parseYmd("tomorrow")).toBeNull();
  });

  it("finds today's entry so the action opens it instead of duplicating it", () => {
    const chapters = [{ title: "Friday, September 25, 2026" }, { title: "Saturday, September 26, 2026" }];
    expect(findEntryForDate(chapters, "2026-09-26")).toBe(chapters[1]);
    expect(findEntryForDate(chapters, "2026-09-27")).toBeNull();
  });

  it("opens each kind with the right first chapter", () => {
    expect(openingChapter("novel").title).toBe("Chapter 1");
    expect(openingChapter("journal", { today: "2026-09-26" }).title).toBe("Saturday, September 26, 2026");
    expect(openingChapter("blog", { title: "Ten notes" }).title).toBe("Ten notes");
    const script = openingChapter("screenplay");
    expect(elementOfHtml(script.content)).toBe("scene-heading");
    expect(nextChapterTitle("screenplay", 1)).toBe("Sequence 2");
    expect(nextChapterTitle("novel", 2)).toBe("Chapter 3");
  });

  it("cycles screenplay elements with Tab and steps them on Enter", () => {
    expect(cycleElement("action")).toBe("character");
    expect(cycleElement("character")).toBe("dialogue");
    expect(cycleElement("action", -1)).toBe("scene-heading");
    let el = cycleElement("action");
    for (let i = 0; i < 5; i++) el = cycleElement(el);
    expect(el).toBe("action");
    expect(nextElementOnEnter("character")).toBe("dialogue");
    expect(nextElementOnEnter("scene-heading")).toBe("action");
    expect(nextElementOnEnter("transition")).toBe("scene-heading");
  });

  it("sets and clears the element on a block's tag", () => {
    const html = '<p data-block-id="a">Hi</p>';
    const dialogue = withElement(html, "dialogue");
    expect(dialogue).toBe('<p data-block-id="a" data-sp="dialogue">Hi</p>');
    expect(elementOfHtml(dialogue)).toBe("dialogue");
    expect(withElement(dialogue, "character")).toBe('<p data-block-id="a" data-sp="character">Hi</p>');
    expect(withElement(dialogue, "action")).toBe(html);
  });

  it("sorts assistant script lines into elements", () => {
    const lines = classifyScreenplayLines(
      "INT. KITCHEN - NIGHT\n\nMara stares at the phone.\n\nMARA\n(quietly)\nHe never called.\n\nCUT TO:"
    );
    expect(lines.map((l) => l.element)).toEqual([
      "scene-heading",
      "action",
      "character",
      "parenthetical",
      "dialogue",
      "transition",
    ]);
  });

  it("reads assistant script lines on from the element before them", () => {
    expect(classifyScreenplayLines("Hi there.\nJON\nHey.", "character").map((l) => l.element)).toEqual([
      "dialogue",
      "character",
      "dialogue",
    ]);
    expect(classifyScreenplayLines("Hi there.", "action").map((l) => l.element)).toEqual(["action"]);
    expect(classifyScreenplayLines("She leaves.", "dialogue").map((l) => l.element)).toEqual(["action"]);
  });

  it("gives the assistant kind-specific prompts and actions", () => {
    expect(kindDirective("novel")).toBe("");
    expect(editorSystemFor("novel")[0].text).toBe(EDITOR_SYSTEM);
    expect(editorSystemFor("screenplay")[0].text).toContain("SCREENPLAY");
    expect(editorSystemFor("journal", "EXTRA")[0].text).toMatch(/JOURNAL[\s\S]*EXTRA$/);
    expect(drafterSystemFor("novel")).toBe(DRAFTER_SYSTEM);
    expect(drafterSystemFor("screenplay")).toContain("script pages");
    expect(quickActionsFor("novel")).toBe(QUICK_ACTIONS);
    for (const kind of MANUSCRIPT_KINDS) {
      const ids = quickActionsFor(kind).map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(quickActionsFor("journal").some((a) => a.id === "journal-prompt")).toBe(true);
  });

  it("agrees with the mobile copy", () => {
    expect(mobileKind.MANUSCRIPT_KINDS).toEqual(MANUSCRIPT_KINDS);
    expect(mobileKind.journalEntryTitle("2026-09-26")).toBe(journalEntryTitle("2026-09-26"));
    expect(mobileKind.cycleElement("dialogue", -1)).toBe(cycleElement("dialogue", -1));
    for (const el of ["scene-heading", "action", "character", "dialogue", "parenthetical", "transition"] as const) {
      expect(mobileKind.nextElementOnEnter(el)).toBe(nextElementOnEnter(el));
      expect(mobileKind.withElement("<p>x</p>", el)).toBe(withElement("<p>x</p>", el));
    }
    expect(mobileKind.openingChapter("screenplay")).toEqual(openingChapter("screenplay"));
    expect(mobileKind.nextChapterTitle("journal", 0)).toBe(nextChapterTitle("journal", 0));
  });
});
