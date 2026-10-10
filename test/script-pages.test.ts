import { describe, expect, it } from "vitest";
import { estimatePages, pagesAsText, typeset, type ScriptBlock } from "@/lib/screenplay";
import { scriptPageCount, scriptPages, type ScriptPage } from "../apps/mobile/lib/script-pages";
import { NIGHT_SHIFT } from "./fixtures/screenplay/night-shift";

const html = (blocks: readonly ScriptBlock[]) =>
  blocks.map((b) => `<p${b.element === "action" ? "" : ` data-sp="${b.element}"`}>${b.text}</p>`).join("");

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
});
