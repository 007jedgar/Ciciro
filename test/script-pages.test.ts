import { describe, expect, it } from "vitest";
import { estimatePages, pagesAsText, typeset, type PageOptions, type ScriptBlock } from "@/lib/screenplay";
import { scriptPageCount, scriptPages, type ScriptPage } from "../apps/mobile/lib/script-pages";
import { NIGHT_SHIFT } from "./fixtures/screenplay/night-shift";

const html = (blocks: readonly ScriptBlock[]) =>
  blocks
    .map(
      (b) =>
        `<p${b.element === "action" ? "" : ` data-sp="${b.element}"`}${b.dual ? ' data-sp-dual="1"' : ""}>${b.text}</p>`
    )
    .join("");
const block = (element: string, text: string, dual?: boolean): ScriptBlock => ({
  element,
  text,
  ...(dual ? { dual: true } : {}),
});
/** Text that wraps to exactly `lines` lines of dialogue: one 35 character word fills a line of the 35 column measure. */
const dialogueLines = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `line${String(i).padStart(2, "0")}`.padEnd(35, "a")).join(" ");

const text = (page: ScriptPage) => page.lines.map((line) => (line ? line.text : "")).join("\n");

describe("the phone's page view", () => {
  it("sets the same pages as the shared engine's typeset, line for line", () => {
    const engine = pagesAsText(typeset(NIGHT_SHIFT).pages);
    const { pages } = scriptPages([html(NIGHT_SHIFT)]);
    expect(pages.map(text)).toEqual(engine);
    expect(pages.map((p) => p.number)).toEqual(engine.map((_, i) => i + 1));
  });

  it("agrees with the page count and numbers sequences on from one another", () => {
    const sequences = [html(NIGHT_SHIFT), html(NIGHT_SHIFT), html(NIGHT_SHIFT.slice(0, 5))];
    const result = scriptPages(sequences);
    expect(result.total).toBe(estimatePages(sequences));
    expect(result.pages.at(-1)?.number).toBe(result.total);
    expect(result.pages.map((p) => p.number)).toEqual(result.pages.map((_, i) => i + 1));
    // Each sequence begins on the page the engine says, never before the one that ran into it.
    expect(result.sequenceStarts[0]).toBe(1);
    expect(result.sequenceStarts[1]).toBeGreaterThanOrEqual(result.sequenceStarts[0]);
    expect(result.sequenceStarts[2]).toBeGreaterThan(result.sequenceStarts[1]);
    for (const page of result.pages) {
      const owners = new Set(page.lines.flatMap((line) => (line ? [line.sequence] : [])));
      expect(owners.size).toBeGreaterThan(0);
    }
  });

  it("carries a page across the end of a sequence instead of starting a new one", () => {
    const short = [{ element: "scene-heading", text: "INT. A - DAY" }, { element: "action", text: "One." }] as const;
    const result = scriptPages([html(short), html(short)]);
    expect(result.pages).toHaveLength(1);
    expect(result.sequenceStarts).toEqual([1, 1]);
    expect(text(result.pages[0])).toBe(
      ["INT. A - DAY", "", "One.", "", "INT. A - DAY", "", "One."].join("\n")
    );
    expect(result.pages[0].lines.map((l) => l?.sequence ?? null)).toEqual([0, null, 0, null, 1, null, 1]);
  });

  it("indents each element to its column and sets a transition flush right", () => {
    const { pages } = scriptPages([
      html([
        { element: "character", text: "mara" },
        { element: "parenthetical", text: "softly" },
        { element: "dialogue", text: "Hello." },
        { element: "transition", text: "cut to:" },
      ]),
    ]);
    expect(pages[0].lines.map((l) => (l ? l.text : null))).toEqual([
      `${" ".repeat(22)}MARA`,
      `${" ".repeat(16)}(softly)`,
      `${" ".repeat(10)}Hello.`,
      null,
      `${" ".repeat(60 - "CUT TO:".length)}CUT TO:`,
    ]);
    expect(pages[0].lines.map((l) => l?.bold ?? null)).toEqual([false, false, false, null, false]);
  });

  it("makes the scene heading bold", () => {
    const { pages } = scriptPages([html([{ element: "scene-heading", text: "int. a" }])]);
    expect(pages[0].lines[0]).toMatchObject({ text: "INT. A", bold: true });
  });

  it("has no pages for a script with nothing typed, however many empty headings", () => {
    const empty = '<p data-sp="scene-heading"></p>';
    expect(scriptPageCount([empty])).toBe(0);
    expect(scriptPageCount([empty, ""])).toBe(0);
    expect(scriptPages([empty]).total).toBe(0);
    expect(scriptPageCount([empty, "<p>Something.</p>"])).toBe(1);
    expect(scriptPages([]).pages).toEqual([]);
  });

  it("sets dual dialogue as two columns on one line, the right one at its own column", () => {
    const { pages } = scriptPages([
      html([
        block("character", "mara"),
        block("dialogue", "I told you."),
        block("character", "jonah", true),
        block("dialogue", "You did."),
      ]),
    ]);
    const lines = pages[0].lines.map((l) => (l ? l.text : null));
    // The cues sit side by side: the left at column 8, the right at column 40.
    expect(lines[0]).toBe(`${" ".repeat(8)}MARA${" ".repeat(40 - 8 - 4)}JONAH`);
    // So do the speeches: the left from the margin, the right from column 32.
    expect(lines[1]).toBe(`I told you.${" ".repeat(32 - "I told you.".length)}You did.`);
    expect(lines).toHaveLength(2);
  });

  it("leaves the left column blank where the right speech runs longer", () => {
    const { pages } = scriptPages([
      html([
        block("character", "mara"),
        block("dialogue", "Hi."),
        block("character", "jonah", true),
        block("dialogue", "One two three four five six seven eight nine ten eleven twelve."),
      ]),
    ]);
    const lines = pages[0].lines.map((l) => (l ? l.text : null));
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[lines.length - 1]).toMatch(/^ {32}\S/);
  });

  it("matches the engine's typeset line for line with dual dialogue, centered text and scene numbers", () => {
    const blocks: ScriptBlock[] = [
      block("scene-heading", "int. lab - night"),
      block("action", "Rain."),
      block("character", "mara"),
      block("dialogue", "I told you."),
      block("character", "jonah", true),
      block("dialogue", "You did."),
      block("centered", "THE END"),
    ];
    const opts: PageOptions = { sceneNumbers: true };
    const engine = pagesAsText(typeset(blocks, opts).pages);
    expect(scriptPages([html(blocks)], opts).pages.map(text)).toEqual(engine);
  });

  it("closes a page a speech runs past with (MORE) and opens the next with the cue and (CONT'D)", () => {
    const blocks = [
      ...Array.from({ length: 24 }, (_, i) => block("action", `Filler ${i}.`)),
      block("character", "mara"),
      block("dialogue", dialogueLines(12)),
    ];
    const { pages, total } = scriptPages([html(blocks)]);
    expect(total).toBe(2);
    expect(pages).toHaveLength(2);
    const notes = pages.flatMap((page) => page.lines.filter((l) => l?.synthetic));
    expect(notes.map((l) => [l?.synthetic, l?.text.trim()])).toEqual([
      ["more", "(MORE)"],
      ["contd", "MARA (CONT'D)"],
    ]);
    // (MORE) closes page 1 at the cue's column; the cue opens page 2.
    expect(pages[0].lines.at(-1)).toMatchObject({ synthetic: "more", text: `${" ".repeat(22)}(MORE)` });
    expect(pages[1].lines[0]).toMatchObject({ synthetic: "contd", text: `${" ".repeat(22)}MARA (CONT'D)` });
  });

  it("takes the script's settings: no (MORE) or (CONT'D) notes, and the page count follows", () => {
    const blocks = [
      ...Array.from({ length: 24 }, (_, i) => block("action", `Filler ${i}.`)),
      block("character", "mara"),
      block("dialogue", dialogueLines(12)),
    ];
    const opts: PageOptions = { more: false, contd: false };
    const result = scriptPages([html(blocks)], opts);
    expect(result.pages.flatMap((page) => page.lines.filter((l) => l?.synthetic))).toEqual([]);
    expect(result.total).toBe(estimatePages([html(blocks)], opts));
    expect(scriptPageCount([html(blocks)], opts)).toBe(result.total);
    expect(scriptPageCount([html(blocks)])).toBe(scriptPages([html(blocks)]).total);
  });

  it("numbers a scene's heading, with the numbers running on across sequences", () => {
    const heading = (place: string) => [block("scene-heading", place), block("action", "Rain.")];
    const result = scriptPages([html(heading("int. a")), html(heading("int. b"))], { sceneNumbers: true });
    const numbered = result.pages.flatMap((page) => page.lines).filter((l) => l?.sceneNumber);
    expect(numbered.map((l) => [l?.text, l?.sceneNumber])).toEqual([
      ["INT. A", "1"],
      ["INT. B", "2"],
    ]);
    const plain = scriptPages([html(heading("int. a"))]);
    expect(plain.pages[0].lines.some((l) => l?.sceneNumber)).toBe(false);
  });

  it("centers a centered block on the 60 column measure", () => {
    const { pages } = scriptPages([html([block("centered", "THE END")])]);
    expect(pages[0].lines[0]?.text).toBe(`${" ".repeat(26)}THE END`);
  });

  it("starts each sequence on the page of its first row, an empty one where the last ended", () => {
    const long = html(Array.from({ length: 70 }, (_, i) => block("action", `Line ${i}.`)));
    const result = scriptPages([long, "", html([block("action", "Last.")])]);
    const lastOfFirst = result.pages.filter((page) => page.lines.some((l) => l?.sequence === 0)).at(-1)?.number ?? 0;
    expect(lastOfFirst).toBeGreaterThan(1);
    expect(result.sequenceStarts[0]).toBe(1);
    expect(result.sequenceStarts[1]).toBe(lastOfFirst);
    expect(result.sequenceStarts[2]).toBeGreaterThanOrEqual(lastOfFirst);
    expect(result.pages.find((page) => page.lines.some((l) => l?.sequence === 2))?.number).toBe(result.sequenceStarts[2]);
  });
});
