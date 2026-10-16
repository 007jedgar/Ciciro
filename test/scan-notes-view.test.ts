import { describe, expect, it } from "vitest";
import {
  entrySlug,
  isEntryFor,
  newEntryPaths,
  SCAN_TEXT_MAX,
  appendScannedNotes,
  boardOrigin,
  countOutlineCards,
  countUncertain,
  demoteHeadings,
  layoutScannedOutline,
  normalizeNotesText,
  notesToOutline,
  combinePages,
  parsePageReading,
  parseScanApply,
  sniffImageType,
  splitCardText,
} from "@/lib/scan-notes-view";
import { CANVAS_ROW_HEIGHT } from "@/lib/canvas-view";
import { KNOWS_END, KNOWS_START } from "@/lib/knowledge-view";

describe("sniffImageType", () => {
  it("reads the type from the first bytes, never from a name", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("refuses HEIC, PDF, text and empty files", () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(sniffImageType(heic)).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("hello"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("normalizeNotesText", () => {
  it("tidies line endings, trailing spaces and runs of blank lines without rewording", () => {
    expect(normalizeNotesText("  Mara  \r\n\r\n\r\n\r\n- the letter   \r\n")).toBe("Mara\n\n- the letter");
  });

  it("drops control characters and caps the length", () => {
    expect(normalizeNotesText("a\u0000b\u0007c")).toBe("abc");
    expect(normalizeNotesText("x".repeat(SCAN_TEXT_MAX + 500))).toHaveLength(SCAN_TEXT_MAX);
  });
});

describe("parsePageReading", () => {
  const read = (text: string, legibility = "clear", kind = "other", title = "") =>
    parsePageReading({ text, legibility, kind, title });

  it("reads a clean page as clear", () => {
    expect(read("# Mara\n- grew up in Hull", "clear", "character", "Mara")).toEqual({
      text: "# Mara\n- grew up in Hull",
      legibility: "clear",
      kind: "character",
      title: "Mara",
    });
  });

  it("calls a page with guesses or gaps partial", () => {
    expect(read("Mara found the lettr [?] in the [illegible] drawer")?.legibility).toBe("partial");
    expect(read("fine words", "partial")?.legibility).toBe("partial");
  });

  it("calls a page with no words unreadable, and a page with words never unreadable", () => {
    expect(read("", "clear")?.legibility).toBe("unreadable");
    expect(read("   ", "partial")?.legibility).toBe("unreadable");
    expect(read("two words", "unreadable")?.legibility).toBe("partial");
  });

  it("defaults an unknown kind and cleans the title", () => {
    const reading = read("x", "clear", "diary", "# The  Fire \n at Kell");
    expect(reading?.kind).toBe("other");
    expect(reading?.title).toBe("The Fire at Kell");
  });

  it("returns null for anything that is not a reading", () => {
    expect(parsePageReading(undefined)).toBeNull();
    expect(parsePageReading("text")).toBeNull();
    expect(parsePageReading({ legibility: "clear" })).toBeNull();
    expect(parsePageReading({ text: 4 })).toBeNull();
  });
});

describe("combinePages", () => {
  const page = (text: string, legibility: "clear" | "partial" | "unreadable" = "clear", kind = "other", title = "") =>
    parsePageReading({ text, legibility, kind, title });

  it("joins pages in order and reads a clean scan as ok", () => {
    const scan = combinePages([page("# Mara\n- grew up in Hull", "clear", "character", "Mara"), page("- left at sixteen")]);
    expect(scan).toMatchObject({
      status: "ok",
      kind: "character",
      title: "Mara",
      uncertain: 0,
      text: "# Mara\n- grew up in Hull\n\n- left at sixteen",
    });
    expect(scan.pages.map((p) => p.legibility)).toEqual(["clear", "clear"]);
    expect(scan.pages.every((p) => !p.failed)).toBe(true);
  });

  it("calls a scan with guesses partial, and counts them", () => {
    const scan = combinePages([page("Mara found the lettr [?] in the [illegible] drawer")]);
    expect(scan.status).toBe("partial");
    expect(scan.uncertain).toBe(2);
  });

  it("is partial when one page is blank, and unreadable when every page is", () => {
    const some = combinePages([page("a note"), page("", "unreadable")]);
    expect(some.status).toBe("partial");
    expect(some.pages[1]).toEqual({ text: "", legibility: "unreadable", failed: false });

    const none = combinePages([page("", "unreadable"), page("  ")]);
    expect(none.status).toBe("unreadable");
    expect(none.text).toBe("");
  });

  it("keeps the pages that read when one page's read went wrong, and marks it failed", () => {
    const scan = combinePages([page("first page"), null, page("third page")]);
    expect(scan.status).toBe("partial");
    expect(scan.text).toBe("first page\n\nthird page");
    expect(scan.pages.map((p) => p.failed)).toEqual([false, true, false]);
    expect(scan.pages[1]).toEqual({ text: "", legibility: "unreadable", failed: true });
    expect(combinePages([null, null]).status).toBe("unreadable");
  });

  it("takes the kind most pages agree on, ignoring pages that said other, and the first title offered", () => {
    const scan = combinePages([
      page("a", "clear", "other", ""),
      page("b", "clear", "world", "Kell"),
      page("c", "clear", "plot", "The fire"),
      page("d", "clear", "world", "Salt"),
    ]);
    expect(scan.kind).toBe("world");
    expect(scan.title).toBe("Kell");
    expect(combinePages([page("a")]).kind).toBe("other");
  });

  it("ignores the kind and title of a page with no words", () => {
    const scan = combinePages([page("", "unreadable", "outline", "Ghost"), page("real", "clear", "plot", "Heist")]);
    expect(scan).toMatchObject({ kind: "plot", title: "Heist" });
  });
});

describe("countUncertain", () => {
  it("counts guesses and gaps, whatever the case", () => {
    expect(countUncertain("a [?] b [illegible] c [Illegible] d")).toBe(3);
    expect(countUncertain("nothing doubtful")).toBe(0);
  });
});

describe("parseScanApply", () => {
  it("accepts each destination", () => {
    expect(parseScanApply({ text: " notes ", destination: { type: "canvas" } })).toEqual({
      ok: true,
      value: { text: "notes", destination: { type: "canvas" } },
    });
    expect(
      parseScanApply({ text: "n", destination: { type: "bible", mode: "append", path: " world.md " } })
    ).toEqual({ ok: true, value: { text: "n", destination: { type: "bible", mode: "append", path: "world.md" } } });
    expect(
      parseScanApply({ text: "n", destination: { type: "bible", mode: "new", kind: "character", name: "  Mara   Vale " } })
    ).toEqual({
      ok: true,
      value: { text: "n", destination: { type: "bible", mode: "new", kind: "character", name: "Mara Vale" } },
    });
  });

  it("says what is wrong", () => {
    const error = (body: unknown) => {
      const result = parseScanApply(body);
      return result.ok ? null : result.error;
    };
    expect(error({ text: "  ", destination: { type: "canvas" } })).toBe("There are no notes to add.");
    expect(error({ text: "n" })).toBe("Choose where to add the notes.");
    expect(error({ text: "n", destination: { type: "bible", mode: "append", path: " " } })).toBe(
      "Choose a story bible file."
    );
    expect(error({ text: "n", destination: { type: "bible", mode: "new", kind: "world", name: "x" } })).toBe(
      "Choose a character or a plot line."
    );
    expect(error({ text: "n", destination: { type: "bible", mode: "new", kind: "plot", name: " " } })).toBe(
      "Name the new entry first."
    );
    expect(error(null)).toBe("There are no notes to add.");
  });
});

describe("appendScannedNotes", () => {
  const notes = "# Kell\n- salt town\n- the fire";

  it("adds a dated section at the end and leaves the file's own text alone", () => {
    const existing = "# World\n> Settings and lore.\n\n- the marsh floods in March\n";
    const next = appendScannedNotes(existing, notes, "2026-10-16");
    expect(next.startsWith(existing.trimEnd())).toBe(true);
    expect(next).toBe(
      "# World\n> Settings and lore.\n\n- the marsh floods in March\n\n## Scanned notes (2026-10-16)\n\n### Kell\n- salt town\n- the fire\n"
    );
  });

  it("keeps the file's summary line (its first non-empty line)", () => {
    const next = appendScannedNotes("# Canon\n> Hard facts.\n", notes, "2026-10-16");
    expect(next.split("\n")[0]).toBe("# Canon");
  });

  it("starts an empty file with the section", () => {
    expect(appendScannedNotes("", "- one", "2026-10-16")).toBe("## Scanned notes (2026-10-16)\n\n- one\n");
  });

  it("is idempotent, so a retry after a lost reply does not duplicate", () => {
    const once = appendScannedNotes("# World\n", notes, "2026-10-16");
    expect(appendScannedNotes(once, notes, "2026-10-16")).toBe(once);
  });

  it("adds a second scan as its own section", () => {
    const once = appendScannedNotes("# World\n", "- a", "2026-10-16");
    const twice = appendScannedNotes(once, "- b", "2026-10-17");
    expect(twice).toContain("## Scanned notes (2026-10-16)\n\n- a\n\n## Scanned notes (2026-10-17)\n\n- b\n");
  });

  it("keeps the who-knows-what mirror block last", () => {
    const existing = `# Mara\n> Character\n\n## Voice\n- dry\n\n${KNOWS_START}\n## Who knows what\n- knows: the pen\n${KNOWS_END}\n`;
    const next = appendScannedNotes(existing, "- sister is Ines", "2026-10-16");
    expect(next.indexOf("## Scanned notes")).toBeLessThan(next.indexOf(KNOWS_START));
    expect(next.trimEnd().endsWith(KNOWS_END)).toBe(true);
    expect(next).toContain("- knows: the pen");
    expect(appendScannedNotes(next, "- sister is Ines", "2026-10-16")).toBe(next);
  });
});

describe("demoteHeadings", () => {
  it("pushes headings down and caps at level six", () => {
    expect(demoteHeadings("# A\ntext #not\n## B\n#### C\n###### D")).toBe("### A\ntext #not\n#### B\n###### C\n###### D");
  });
});

describe("splitCardText", () => {
  it("keeps a short line as the title", () => {
    expect(splitCardText("Mara finds the letter")).toEqual({ title: "Mara finds the letter", body: "" });
  });

  it("titles a long line with its first sentence and keeps the rest as the body", () => {
    const text =
      "Mara finds the letter in the drawer. She does not open it until night, when the house is quiet and her aunt has gone to bed.";
    expect(splitCardText(text)).toEqual({
      title: "Mara finds the letter in the drawer",
      body: "She does not open it until night, when the house is quiet and her aunt has gone to bed.",
    });
  });

  it("cuts a long line with no sentence end at a word and keeps every word in the body", () => {
    const text = "the aunt hides the key and the ledger and the photograph of the boat in the cellar behind the coal sacks";
    const { title, body } = splitCardText(text);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(body).toBe(text);
  });
});

describe("notesToOutline", () => {
  it("makes a flat list of cards in reading order, dropping bullets and numbers", () => {
    const nodes = notesToOutline("1. Mara finds the letter\n2) She confronts her aunt\n- Hull burns\n* The boat\n• Epilogue");
    expect(nodes.map((n) => n.title)).toEqual([
      "Mara finds the letter",
      "She confronts her aunt",
      "Hull burns",
      "The boat",
      "Epilogue",
    ]);
    expect(nodes.every((n) => n.children.length === 0)).toBe(true);
  });

  it("nests an indented bullet under the one above it", () => {
    const nodes = notesToOutline("- Act one\n  - Mara arrives\n  - The letter\n    - who sent it\n- Act two");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.children.map((n) => n.title)).toEqual(["Mara arrives", "The letter"]);
    expect(nodes[0]!.children[1]!.children.map((n) => n.title)).toEqual(["who sent it"]);
    expect(nodes[1]!.title).toBe("Act two");
  });

  it("makes a heading a card and the lines under it its children", () => {
    const nodes = notesToOutline("# Part one\n- arrival\n- the letter\n\n# Part two\n## Midpoint\n- the fire");
    expect(nodes.map((n) => n.title)).toEqual(["Part one", "Part two"]);
    expect(nodes[0]!.children.map((n) => n.title)).toEqual(["arrival", "the letter"]);
    expect(nodes[1]!.children.map((n) => n.title)).toEqual(["Midpoint"]);
    expect(nodes[1]!.children[0]!.children.map((n) => n.title)).toEqual(["the fire"]);
  });

  it("joins an indented line with no marker onto the line above it", () => {
    const nodes = notesToOutline("- Mara finds the letter\n  and hides it\n- Next");
    expect(nodes.map((n) => n.title)).toEqual(["Mara finds the letter and hides it", "Next"]);
  });

  it("drops checkboxes and blank lines, and makes a bare paragraph a card of its own", () => {
    const nodes = notesToOutline("- [ ] call the printer\n\n\n- [x] book the train\nJust a thought");
    expect(nodes.map((n) => n.title)).toEqual(["call the printer", "book the train", "Just a thought"]);
  });

  it("keeps every word of a long line", () => {
    const [node] = notesToOutline(
      "- Mara finds the letter in the drawer. She does not open it until night, when the house is quiet."
    );
    expect(node!.title).toBe("Mara finds the letter in the drawer");
    expect(node!.body).toBe("She does not open it until night, when the house is quiet.");
  });

  it("returns nothing for empty text and counts the whole tree", () => {
    expect(notesToOutline("  \n\n")).toEqual([]);
    expect(countOutlineCards(notesToOutline("- a\n  - b\n  - c\n- d"))).toBe(4);
  });

  it("never nests deeper than six levels", () => {
    const text = Array.from({ length: 10 }, (_, i) => `${"  ".repeat(i)}- level ${i}`).join("\n");
    let depth = 0;
    let level = notesToOutline(text);
    while (level.length) {
      depth += 1;
      level = level[0]!.children;
    }
    expect(depth).toBeLessThanOrEqual(6);
    expect(countOutlineCards(notesToOutline(text))).toBe(10);
  });
});

describe("boardOrigin and layoutScannedOutline", () => {
  it("starts an empty board near the corner", () => {
    expect(boardOrigin([])).toEqual({ x: 80, top: 80 });
  });

  it("starts below the lowest card, at the left edge of the board", () => {
    expect(boardOrigin([{ x: 120, y: 40 }, { x: 40, y: 600 }])).toEqual({ x: 40, top: 600 + CANVAS_ROW_HEIGHT });
  });

  it("places the first row at the origin and gives children a row below their parent", () => {
    const placed = layoutScannedOutline(notesToOutline("- a\n  - b"), { x: 80, top: 80 });
    expect(placed).toHaveLength(2);
    expect(placed[0]!.y).toBe(80);
    expect(placed[1]!.y).toBe(80 + CANVAS_ROW_HEIGHT);
    expect(placed[0]!.parentKey).toBeNull();
    expect(placed[1]!.parentKey).toBe(placed[0]!.key);
  });

  it("wraps a long flat list into rows of four, so it reads down the board", () => {
    const placed = layoutScannedOutline(notesToOutline("- 1\n- 2\n- 3\n- 4\n- 5\n- 6"), { x: 80, top: 80 });
    expect(placed.map((card) => card.y)).toEqual([80, 80, 80, 80, 80 + CANVAS_ROW_HEIGHT, 80 + CANVAS_ROW_HEIGHT]);
    expect(placed[4]!.x).toBe(placed[0]!.x);
    expect(new Set(placed.map((card) => card.key)).size).toBe(6);
  });

  it("leaves room under a band that has children before the next band starts", () => {
    const placed = layoutScannedOutline(notesToOutline("- 1\n  - 1a\n- 2\n- 3\n- 4\n- 5"), { x: 80, top: 80 });
    const five = placed.find((card) => card.title === "5")!;
    expect(five.y).toBe(80 + 2 * CANVAS_ROW_HEIGHT);
  });

  it("never gives two cards the same spot", () => {
    const text = Array.from({ length: 20 }, (_, i) => `- item ${i}\n  - child ${i}`).join("\n");
    const placed = layoutScannedOutline(notesToOutline(text), { x: 80, top: 80 });
    const spots = new Set(placed.map((card) => `${card.x},${card.y}`));
    expect(spots.size).toBe(placed.length);
  });
});

describe("new entry paths", () => {
  it("keeps the bible's usual name for a Latin name, then one that keeps every letter", () => {
    expect(newEntryPaths("character", "Mara Vale").slice(0, 2)).toEqual(["characters/mara-vale.md", "characters/mara-vale-2.md"]);
    expect(newEntryPaths("plot", "José").slice(0, 3)).toEqual(["plot/jos.md", "plot/josé.md", "plot/josé-2.md"]);
  });

  it("gives different non-Latin names different paths", () => {
    expect(newEntryPaths("character", "张三")[0]).toBe("characters/张三.md");
    expect(newEntryPaths("character", "李四")[0]).toBe("characters/李四.md");
    expect(entrySlug("राम कुमार")).toBe("राम-कुमार");
    expect(entrySlug("!!!")).toBe("unnamed");
  });

  it("matches a file to a name by its title", () => {
    expect(isEntryFor("# 张三\n> Character\n", "张三")).toBe(true);
    expect(isEntryFor("# 张三\n> Character\n", "李四")).toBe(false);
    expect(isEntryFor("# Mara Vale\n", "mara  vale")).toBe(true);
    expect(isEntryFor("no title here\n", "Anyone")).toBe(true);
  });
});
