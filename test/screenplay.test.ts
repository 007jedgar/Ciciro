import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ELEMENT_METRICS,
  PAGE_COLUMNS,
  PAGE_LINES,
  SCREENPLAY_ELEMENTS,
  SHORTCUT_ORDER,
  blankLinesBefore,
  cycleElement,
  dialogueGroups,
  elementForShortcutDigit,
  elementOfHtml,
  elementTag,
  estimatePages,
  knownElement,
  layout,
  layoutHtml,
  nextElementOnEnter,
  normalizeElement,
  paginate,
  pagesAsText,
  scenes,
  scriptBlocksFromHtml,
  sequenceCursors,
  shortcutDigit,
  elementTagOfHtml,
  typeset,
  withElement,
  wrapText,
  type ScriptBlock,
} from "@/lib/screenplay";
import { NIGHT_SHIFT } from "./fixtures/screenplay/night-shift";

const block = (element: string, text: string): ScriptBlock => ({ element, text });
const words = (n: number, word = "word") => Array.from({ length: n }, () => word).join(" ");

describe("screenplay elements", () => {
  it("knows seven elements, Shot among them", () => {
    expect(SCREENPLAY_ELEMENTS).toContain("shot");
    expect(SCREENPLAY_ELEMENTS).toHaveLength(7);
    expect(Object.keys(ELEMENT_METRICS).sort()).toEqual([...SCREENPLAY_ELEMENTS].sort());
  });

  it("keeps an element it does not know instead of collapsing it to action", () => {
    expect(elementTag("centered")).toBe("centered");
    expect(elementTag("dual-1")).toBe("dual-1");
    expect(normalizeElement("centered")).toBe("action");
    expect(knownElement("centered")).toBeNull();
    expect(knownElement("shot")).toBe("shot");

    const html = '<p data-block-id="b1" data-sp="centered">THE END</p>';
    expect(elementTagOfHtml(html)).toBe("centered");
    expect(elementOfHtml(html)).toBe("action");
    // Restamping a block (what both clients do on every edit) must not strip it.
    expect(withElement(html, elementTagOfHtml(html))).toBe(html);
    expect(withElement(html, "dialogue")).toBe('<p data-block-id="b1" data-sp="dialogue">THE END</p>');
    expect(withElement(html, "action")).toBe('<p data-block-id="b1">THE END</p>');
  });

  it("stores only a plain slug, so a tag cannot break out of its attribute", () => {
    expect(elementTag('x" onclick="y')).toBe("action");
    expect(elementTag("")).toBe("action");
    expect(elementTag("  ")).toBe("action");
    expect(elementTag(undefined)).toBe("action");
    expect(elementTag(7)).toBe("action");
    expect(withElement("<p>hi</p>", '"><script>')).toBe("<p>hi</p>");
  });

  it("walks the Tab ring through Shot and back around", () => {
    let el = cycleElement("action");
    const seen = [el];
    for (let i = 0; i < 6; i++) seen.push((el = cycleElement(el)));
    expect(seen).toEqual(["character", "dialogue", "parenthetical", "transition", "shot", "scene-heading", "action"]);
    expect(cycleElement("action", -1)).toBe("scene-heading");
    expect(cycleElement("scene-heading", -1)).toBe("shot");
  });

  it("treats a shot like a scene heading on Enter", () => {
    expect(nextElementOnEnter("shot")).toBe("action");
    expect(nextElementOnEnter("scene-heading")).toBe("action");
  });

  it("gives every element one Alt+Shift digit, and never the browsers' Cmd/Ctrl digits", () => {
    expect(SHORTCUT_ORDER).toHaveLength(SCREENPLAY_ELEMENTS.length);
    expect(new Set(SHORTCUT_ORDER)).toEqual(new Set(SCREENPLAY_ELEMENTS));
    for (const el of SCREENPLAY_ELEMENTS) expect(elementForShortcutDigit(shortcutDigit(el))).toBe(el);
    expect(elementForShortcutDigit(0)).toBeNull();
    expect(elementForShortcutDigit(8)).toBeNull();
    expect(elementForShortcutDigit("6")).toBe("shot");
    expect(elementForShortcutDigit("x")).toBeNull();
  });
});

describe("wrapping", () => {
  it("breaks after spaces and keeps the words whole", () => {
    expect(wrapText("one two three four", 9).map((l) => l.text)).toEqual(["one two", "three", "four"]);
  });

  it("lets a line be exactly as wide as the measure", () => {
    const line = words(12, "abcd").slice(0, 58); // 58 columns
    expect(wrapText(`${line} x`, 60).map((l) => l.text)).toEqual([`${line} x`]);
    expect(wrapText(`${line} xy`, 60).map((l) => l.text)).toEqual([line, "xy"]);
  });

  it("starts each wrapped line from where the text really is", () => {
    const text = "alpha beta gamma delta";
    const lines = wrapText(text, 11);
    expect(lines.map((l) => l.text)).toEqual(["alpha beta", "gamma delta"]);
    expect(lines.map((l) => text.slice(l.start, l.start + 5))).toEqual(["alpha", "gamma"]);
  });

  it("keeps leading spaces, but spaces left at a wrap do not start the next line", () => {
    expect(wrapText("   indented", 40).map((l) => l.text)).toEqual(["   indented"]);
    expect(wrapText("aaaa     bbbb", 6).map((l) => l.text)).toEqual(["aaaa", "bbbb"]);
  });

  it("breaks a word longer than the measure where it overflows", () => {
    expect(wrapText("abcdefghij", 4).map((l) => l.text)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("ab abcdefghij", 4).map((l) => l.text)).toEqual(["ab", "abcd", "efgh", "ij"]);
  });

  it("may break after a hyphen between letters, as a browser does", () => {
    expect(wrapText("well-known fact", 8).map((l) => l.text)).toEqual(["well-", "known", "fact"]);
    // A dash with spaces around it, or a minus before a number, is not a place to break inside a word.
    expect(wrapText("a - b", 5).map((l) => l.text)).toEqual(["a - b"]);
    expect(wrapText("temp -5", 6).map((l) => l.text)).toEqual(["temp", "-5"]);
  });

  it("starts a new line on a hard break and keeps an empty one", () => {
    expect(wrapText("one\ntwo", 20).map((l) => l.text)).toEqual(["one", "two"]);
    expect(wrapText("one\n\nthree", 20).map((l) => l.text)).toEqual(["one", "", "three"]);
    expect(wrapText("", 20)).toEqual([{ text: "", start: 0 }]);
  });

  it("counts a combining mark as no column and a wide character as two", () => {
    const decomposed = "ñ".repeat(5); // five ñ, ten code units, five columns
    expect(wrapText(decomposed, 5)).toHaveLength(1);
    expect(wrapText("世界你好吗", 4).map((l) => l.text)).toEqual(["世界", "你好", "吗"]);
  });
});

describe("laying out an element", () => {
  it("sets scene headings, cues, transitions and shots in capitals and leaves the rest as typed", () => {
    const laid = layout([
      block("scene-heading", "int. lab - day"),
      block("action", "Mara waits."),
      block("character", "mara"),
      block("dialogue", "Hello?"),
      block("transition", "cut to:"),
      block("shot", "close on the door"),
    ]);
    expect(laid.map((b) => b.lines[0].text)).toEqual([
      "INT. LAB - DAY",
      "Mara waits.",
      "MARA",
      "Hello?",
      "CUT TO:",
      "CLOSE ON THE DOOR",
    ]);
  });

  it("puts brackets on a parenthetical and keeps offsets in the block's own text", () => {
    const [b] = layout([block("parenthetical", words(8, "whisper"))]);
    expect(b.lines[0].text.startsWith("(whisper")).toBe(true);
    expect(b.lines[0].start).toBe(0);
    expect(b.lines[1].start).toBeGreaterThan(0);
    const source = words(8, "whisper");
    expect(source.slice(b.lines[1].start, b.lines[1].start + 7)).toBe("whisper");
  });

  it("indents and sizes each element on the 60 column page", () => {
    const m = ELEMENT_METRICS;
    expect(PAGE_COLUMNS).toBe(60);
    expect(PAGE_LINES).toBe(54);
    expect([m["scene-heading"].indent, m["scene-heading"].width]).toEqual([0, 60]);
    expect([m.action.indent, m.action.width]).toEqual([0, 60]);
    expect([m.character.indent, m.character.width]).toEqual([22, 38]);
    expect([m.dialogue.indent, m.dialogue.width]).toEqual([10, 35]);
    expect([m.parenthetical.indent, m.parenthetical.width]).toEqual([16, 25]);
    expect(m.transition.align).toBe("right");
    // Nothing runs past the right margin.
    for (const el of SCREENPLAY_ELEMENTS) expect(m[el].indent + m[el].width).toBeLessThanOrEqual(PAGE_COLUMNS);
  });

  it("sets an element it does not know as action", () => {
    const [b] = layout([block("centered", "the end")]);
    expect(b.element).toBe("action");
    expect(b.lines[0].text).toBe("the end");
  });

  it("puts one blank line between blocks, none inside a speech", () => {
    expect(blankLinesBefore("action", "action")).toBe(1);
    expect(blankLinesBefore("character", "action")).toBe(1);
    expect(blankLinesBefore("scene-heading", null)).toBe(1);
    expect(blankLinesBefore("dialogue", "character")).toBe(0);
    expect(blankLinesBefore("parenthetical", "character")).toBe(0);
    expect(blankLinesBefore("dialogue", "parenthetical")).toBe(0);
    expect(blankLinesBefore("parenthetical", "dialogue")).toBe(0);
    expect(blankLinesBefore("dialogue", "dialogue")).toBe(1);
    expect(blankLinesBefore("dialogue", "action")).toBe(1);
  });
});

describe("pagination", () => {
  it("fits a short script on one page and counts it", () => {
    const { pagination } = typeset([block("scene-heading", "int. lab - day"), block("action", "A beat.")]);
    expect(pagination.pages).toBe(1);
    expect(pagination.breaks).toEqual([]);
    expect(pagination.end).toEqual({ page: 1, line: 3 });
  });

  it("reports no pages for a script with nothing on it", () => {
    expect(paginate(layout([])).pages).toBe(0);
    expect(estimatePages([])).toBe(0);
    expect(estimatePages(["", ""])).toBe(0);
  });

  it("starts a page at 54 lines, dropping the blank line at the top", () => {
    // 27 one-line actions take 27 + 26 blank lines = 53 lines; the next needs 2 more.
    const blocks = Array.from({ length: 28 }, (_, i) => block("action", `Line ${i}.`));
    const { pages, pagination } = typeset(blocks);
    expect(pagination.breaks).toEqual([{ page: 2, block: 27, line: 0, offset: 0 }]);
    expect(pages[0]).toHaveLength(53);
    expect(pages[1][0]?.text).toBe("Line 27.");
  });

  it("keeps a scene heading with the action under it", () => {
    const filler = Array.from({ length: 26 }, (_, i) => block("action", `Line ${i}.`)); // 51 lines
    const { pagination } = typeset([
      ...filler,
      block("scene-heading", "int. lab - day"),
      block("action", words(30)),
    ]);
    // The heading would fit on page 1 (53 lines) but not with two lines of action.
    expect(pagination.breaks[0]).toMatchObject({ page: 2, block: 26, line: 0 });
  });

  it("keeps a cue with its first lines of speech, and a parenthetical with the line after", () => {
    const filler = Array.from({ length: 26 }, (_, i) => block("action", `Line ${i}.`)); // 51 lines
    const { pagination } = typeset([
      ...filler,
      block("character", "mara"),
      block("parenthetical", "softly"),
      block("dialogue", words(20)),
    ]);
    expect(pagination.breaks[0]).toMatchObject({ page: 2, block: 26, line: 0 });
  });

  it("splits a long action across a page with two lines on each side", () => {
    const filler = Array.from({ length: 24 }, (_, i) => block("action", `Line ${i}.`)); // 47 lines
    const long = block("action", words(120)); // 5 columns a word + space: 11 words a line
    const laid = layout([...filler, long]);
    const total = laid[24].lines.length;
    const { breaks } = paginate(laid);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].block).toBe(24);
    // 47 lines used, one blank line, then the action fills the page.
    expect(breaks[0].line).toBe(PAGE_LINES - 47 - 1);
    expect(total - breaks[0].line).toBeGreaterThanOrEqual(2);
    expect(breaks[0].offset).toBe(laid[24].lines[breaks[0].line].start);
  });

  it("never leaves one line of an action behind or carries just one over", () => {
    const five = block("action", "a\nb\nc\nd\ne");
    let split = 0;
    for (let k = 14; k <= 27; k++) {
      const filler = Array.from({ length: k }, (_, i) => block("action", `Line ${i}.`));
      const laid = layout([...filler, five]);
      const mid = paginate(laid).breaks.filter((x) => x.block === k && x.line > 0);
      for (const b of mid) {
        split++;
        expect(b.line).toBeGreaterThanOrEqual(2);
        expect(5 - b.line).toBeGreaterThanOrEqual(2);
      }
    }
    expect(split).toBeGreaterThan(0);
  });

  it("moves a short action that does not fit whole to the next page", () => {
    const filler = Array.from({ length: 26 }, (_, i) => block("action", `Line ${i}.`)); // 51 lines
    const { pagination } = typeset([...filler, block("action", "Three words\nin three\nlines.")]);
    expect(pagination.breaks[0]).toMatchObject({ page: 2, block: 26, line: 0 });
  });

  it("continues from where the last sequence stopped", () => {
    const one = '<p data-sp="scene-heading">int. a - day</p><p>It begins.</p>';
    const { starts, end } = sequenceCursors([one, one, one]);
    expect(starts[0]).toEqual({ page: 1, line: 0 });
    // Three lines, then a blank line before the next sequence's heading.
    expect(starts[1]).toEqual({ page: 1, line: 3 });
    expect(starts[2]).toEqual({ page: 1, line: 7 });
    expect(end).toEqual({ page: 1, line: 11 });
    const long = `<p>${words(2000)}</p>`;
    expect(estimatePages([long, one])).toBeGreaterThanOrEqual(estimatePages([long]));
    expect(estimatePages([long, long])).toBeGreaterThan(estimatePages([long]));
  });

  it("counts the pages of a long script from its sequences as one continuous flow", () => {
    const sequence = NIGHT_SHIFT.map((b) => `<p data-sp="${b.element}">${b.text}</p>`).join("");
    expect(estimatePages([sequence])).toBe(2);
    const four = estimatePages([sequence, sequence, sequence, sequence]);
    expect(four).toBe(paginate(layout([...NIGHT_SHIFT, ...NIGHT_SHIFT, ...NIGHT_SHIFT, ...NIGHT_SHIFT])).pages);
    expect(four).toBeGreaterThan(estimatePages([sequence, sequence]));
  });

  it("is fast enough to run on every keystroke of a feature-length script", () => {
    const sequence = NIGHT_SHIFT.map((b) => `<p data-sp="${b.element}">${b.text}</p>`).join("");
    const chapters = Array.from({ length: 60 }, () => sequence); // about 120 pages
    const started = performance.now();
    estimatePages(chapters);
    // Cold: every chapter is the same string, so this is one layout and 60 paginations.
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("reading a chapter's HTML", () => {
  it("reads the element, line breaks, entities, and tags", () => {
    expect(
      scriptBlocksFromHtml(
        '<p data-block-id="a" data-sp="character">Mara <em>&amp;</em> Jonah</p><p>Line one<br>line two &lt;3 &#233;</p>'
      )
    ).toEqual([
      { element: "character", text: "Mara & Jonah" },
      { element: "action", text: "Line one\nline two <3 é" },
    ]);
  });

  it("sets a heading, quote or list item as action and skips a rule", () => {
    expect(scriptBlocksFromHtml("<h1>Title</h1><hr><blockquote>q</blockquote><ul><li>x</li></ul>")).toEqual([
      { element: "action", text: "Title" },
      { element: "action", text: "q" },
      { element: "action", text: "x" },
    ]);
  });

  it("keeps an element from a newer client through the round trip", () => {
    expect(scriptBlocksFromHtml('<p data-sp="centered">THE END</p>')).toEqual([
      { element: "centered", text: "THE END" },
    ]);
  });

  it("remembers the layout of a chapter it has just seen", () => {
    const html = '<p data-sp="character">mara</p>';
    expect(layoutHtml(html)).toBe(layoutHtml(html));
  });
});

describe("a script's structure", () => {
  const script = [
    block("action", "Cold open."),
    block("scene-heading", "int. a - day"),
    block("character", "mara"),
    block("parenthetical", "softly"),
    block("dialogue", "Hi."),
    block("character", "jonah"),
    block("dialogue", "Hey."),
    block("scene-heading", "ext. b - night"),
    block("action", "Rain."),
  ];

  it("finds scenes from heading to heading, with any lead-in apart", () => {
    expect(scenes(script)).toEqual([
      { heading: null, start: 0, end: 1 },
      { heading: 1, start: 1, end: 7 },
      { heading: 7, start: 7, end: 9 },
    ]);
    expect(scenes([block("scene-heading", "int. a - day")])).toEqual([{ heading: 0, start: 0, end: 1 }]);
    expect(scenes([])).toEqual([]);
  });

  it("finds a cue and what it speaks", () => {
    expect(dialogueGroups(script)).toEqual([
      { character: 2, start: 2, end: 5 },
      { character: 5, start: 5, end: 7 },
    ]);
  });
});

describe("golden pages", () => {
  const file = join(__dirname, "fixtures/screenplay/night-shift.pages.txt");
  const rendered = () =>
    pagesAsText(typeset(NIGHT_SHIFT).pages)
      .map((page, i) => `---- page ${i + 1} ----\n${page}`)
      .join("\n");

  it("sets the fixture script on the same pages as the golden file", () => {
    if (process.env.UPDATE_GOLDEN) writeFileSync(file, `${rendered()}\n`);
    expect(`${rendered()}\n`).toBe(readFileSync(file, "utf8"));
  });

  it("fills the first page to exactly 54 lines", () => {
    const first = typeset(NIGHT_SHIFT).pages[0];
    expect(first).toHaveLength(PAGE_LINES);
  });
});
