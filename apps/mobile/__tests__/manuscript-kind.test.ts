import {
  cycleElement,
  defaultTitle,
  elementOfHtml,
  findEntryForDate,
  journalEntryTitle,
  localYmd,
  nextChapterTitle,
  nextElementOnEnter,
  normalizeKind,
  openingChapter,
  parseYmd,
  withElement,
} from "../lib/manuscript-kind";
import { openTodayEntry } from "../lib/journal";
import { chapterHeading } from "../lib/chapter-label";

const t = (key: string, opts?: { number: number }) =>
  ({
    "chapters.number": `Chapter ${opts?.number}`,
    "chapters.newTitle": "New chapter",
    "kinds.sequenceNumber": `Sequence ${opts?.number}`,
    "kinds.entryNumber": `Entry ${opts?.number}`,
    "kinds.post": "Post",
  })[key] ?? key;

describe("manuscript kind", () => {
  it("reads anything unknown as a novel", () => {
    expect(normalizeKind(undefined)).toBe("novel");
    expect(normalizeKind("haiku")).toBe("novel");
    expect(normalizeKind("journal")).toBe("journal");
    expect(defaultTitle("journal")).toBe("Journal");
  });

  it("dates journal entries from a calendar date", () => {
    expect(journalEntryTitle("2026-09-26")).toBe("Saturday, September 26, 2026");
    expect(parseYmd("2026-13-01")).toBeNull();
    expect(localYmd(new Date(2026, 8, 6))).toBe("2026-09-06");
  });

  it("opens each kind on the right first chapter", () => {
    expect(openingChapter("journal", { today: "2026-09-26" }).title).toBe("Saturday, September 26, 2026");
    expect(elementOfHtml(openingChapter("screenplay").content)).toBe("scene-heading");
    expect(nextChapterTitle("screenplay", 2)).toBe("Sequence 3");
  });

  it("walks screenplay elements like Tab and Enter", () => {
    expect(cycleElement("action")).toBe("character");
    expect(cycleElement("action", -1)).toBe("scene-heading");
    expect(nextElementOnEnter("character")).toBe("dialogue");
    expect(nextElementOnEnter("dialogue")).toBe("action");
    expect(withElement('<p data-block-id="a">x</p>', "dialogue")).toBe(
      '<p data-block-id="a" data-sp="dialogue">x</p>'
    );
    expect(withElement('<p data-block-id="a" data-sp="dialogue">x</p>', "action")).toBe(
      '<p data-block-id="a">x</p>'
    );
  });
});

describe("journal entry for today", () => {
  const chapters = [{ id: "c1", title: "Friday, September 25, 2026" }];

  it("opens today's entry when it exists, without adding another", async () => {
    const all = [...chapters, { id: "c2", title: "Saturday, September 26, 2026" }];
    expect(findEntryForDate(all, "2026-09-26")?.id).toBe("c2");
    const add = jest.fn();
    const select = jest.fn();
    const opened = await openTodayEntry(all, add, select, "2026-09-26");
    expect(opened.id).toBe("c2");
    expect(select).toHaveBeenCalledWith("c2");
    expect(add).not.toHaveBeenCalled();
  });

  it("starts a dated entry when today has none", async () => {
    const add = jest.fn(async (title: string) => ({ id: "c3", title }));
    const select = jest.fn();
    const created = await openTodayEntry(chapters, add, select, "2026-09-26");
    expect(add).toHaveBeenCalledWith("Saturday, September 26, 2026");
    expect(created.id).toBe("c3");
    expect(select).toHaveBeenCalledWith("c3");
  });
});

describe("chapter heading by kind", () => {
  it("numbers novel chapters and screenplay sequences", () => {
    expect(chapterHeading("novel", 2, "Chapter 2", t)).toEqual({
      heading: "Chapter 2",
      custom: null,
      label: "Chapter 2",
    });
    expect(chapterHeading("screenplay", 2, "The Heist", t)).toEqual({
      heading: "Sequence 2",
      custom: "The Heist",
      label: "Sequence 2, The Heist",
    });
  });

  it("leads a journal row with its date and a blog row with its title", () => {
    expect(chapterHeading("journal", 1, "Saturday, September 26, 2026", t).heading).toBe(
      "Saturday, September 26, 2026"
    );
    expect(chapterHeading("journal", 4, "", t).heading).toBe("Entry 4");
    expect(chapterHeading("blog", 1, "Ten notes", t).heading).toBe("Ten notes");
  });
});
