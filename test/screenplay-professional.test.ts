import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRIPT_SETTINGS,
  DUAL_METRICS,
  ELEMENT_METRICS,
  PAGE_LINES,
  contdCue,
  dualOfHtml,
  dualPairs,
  elementTagOfHtml,
  estimatePages,
  layout,
  pagesAsText,
  paginate,
  parseScriptSettings,
  resolveTitlePage,
  scriptBlocksFromHtml,
  sequenceCursors,
  serializeScriptSettings,
  styledBlocksFromHtml,
  typeset,
  typesetSequences,
  withDual,
  withElement,
  type PageRow,
  type ScriptBlock,
} from "@/lib/screenplay";

const block = (element: string, text: string, dual?: boolean): ScriptBlock => ({
  element,
  text,
  ...(dual ? { dual: true } : {}),
});
const words = (n: number, word = "word") => Array.from({ length: n }, () => word).join(" ");
/** Text that wraps to exactly `lines` lines of dialogue: one 35 character word fills a line of the 35 column measure. */
const dialogueLines = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `line${String(i).padStart(2, "0")}`.padEnd(35, "a")).join(" ");
const filler = (count: number) => Array.from({ length: count }, (_, i) => block("action", `Filler ${i}.`));

function textOf(rows: readonly PageRow[]): string[] {
  return rows.map((row) => (row ? row.text : ""));
}

describe("centered text", () => {
  it("is an element with its own slot, set across the whole page", () => {
    expect(ELEMENT_METRICS.centered).toMatchObject({ indent: 0, width: 60, align: "center", caps: false });
  });

  it("centres each line of the block on the 60 column measure", () => {
    const { pages } = typeset([block("centered", "THE END")]);
    expect(pagesAsText(pages)[0]).toBe(`${" ".repeat(26)}THE END`);
  });

  it("wraps like action and breaks across a page like action", () => {
    const [b] = layout([block("centered", words(30))]);
    expect(b.lines.length).toBeGreaterThan(1);
    expect(b.align).toBe("center");
  });
});

describe("dual dialogue", () => {
  const pair = [
    block("character", "mara"),
    block("dialogue", "I told you."),
    block("character", "jonah", true),
    block("parenthetical", "quietly"),
    block("dialogue", "You did, and I listened to every word."),
  ];

  it("pairs a flagged speech with the one touching it above", () => {
    const found = dualPairs(pair);
    expect(found).toHaveLength(1);
    expect(found[0].left).toMatchObject({ start: 0, end: 2 });
    expect(found[0].right).toMatchObject({ start: 2, end: 5 });
  });

  it("ignores a flag with nothing right above it, or on the second of a pair", () => {
    expect(dualPairs([block("character", "mara", true), block("dialogue", "Hi.")])).toEqual([]);
    expect(
      dualPairs([
        block("character", "mara"),
        block("dialogue", "Hi."),
        block("action", "A beat."),
        block("character", "jonah", true),
        block("dialogue", "Hello."),
      ])
    ).toEqual([]);
    const three = [...pair, block("character", "ana", true), block("dialogue", "Me too.")];
    expect(dualPairs(three)).toHaveLength(1);
    const laid = layout(three);
    expect(laid[5].dual).toBeUndefined();
  });

  it("sets each speech in its own column, side by side", () => {
    const laid = layout(pair);
    expect(laid[1].dual).toEqual({ side: "left", pair: 0 });
    expect(laid[4].dual).toEqual({ side: "right", pair: 0 });
    expect(laid[1]).toMatchObject({ indent: DUAL_METRICS.left.dialogue!.indent, width: 28 });
    expect(laid[4]).toMatchObject({ indent: DUAL_METRICS.right.dialogue!.indent, width: 28 });
    // Both columns open on the same line.
    expect(laid[0].before).toBe(laid[2].before);
  });

  it("puts the two columns on the same rows", () => {
    const { pages } = typeset([block("action", "Two at once."), ...pair]);
    const text = pagesAsText(pages)[0].split("\n");
    expect(text[0]).toBe("Two at once.");
    expect(text[1]).toBe("");
    // cue / cue on one row, then the left speech beside the right's parenthetical.
    expect(text[2]).toMatch(/^ {8}MARA {28}JONAH$/);
    expect(text[3]).toMatch(/^I told you\. {25}\(quietly\)$/);
    expect(text[4]).toMatch(/^ {32}You did, and I listened to$/);
    expect(text[5]).toBe(`${" ".repeat(32)}every word.`);
  });

  it("counts a pair as tall as its taller side", () => {
    const left = [block("character", "a"), block("dialogue", dialogueLines(3))];
    const right = [block("character", "b", true), block("dialogue", "Short.")];
    const laid = layout([...left, ...right]);
    const rows = Math.max(1 + laid[1].lines.length, 1 + laid[3].lines.length);
    const { pagination } = typeset([...left, ...right]);
    expect(pagination.end.line).toBe(rows);
  });

  it("never splits a pair across a page: it moves whole", () => {
    const blocks = [...filler(26), ...pair, ...Array.from({ length: 4 }, () => block("action", "After."))];
    const set = typesetSequences([blocks]);
    // 26 filler blocks take 51 lines; the pair needs 5 more, so it starts page 2.
    const first = set.pages[1].find((r) => r)!;
    expect(first.text).toBe("MARA");
    expect(first.right?.text).toBe("JONAH");
    expect(set.pages[0].every((r) => !r || !r.right)).toBe(true);
  });

  it("falls back to two speeches in turn when the pair is taller than a page", () => {
    const tall = block("dialogue", words(400));
    const laid = layout([block("character", "mara"), tall, block("character", "jonah", true), block("dialogue", "Hi.")]);
    expect(laid.every((b) => !b.dual)).toBe(true);
  });

  it("reads the flag off a cue's HTML, and drops it when the element changes", () => {
    const html = '<p data-sp="character" data-sp-dual="1" data-block-id="b1">JONAH</p>';
    expect(dualOfHtml(html)).toBe(true);
    expect(elementTagOfHtml(html)).toBe("character");
    expect(styledBlocksFromHtml(html)[0].dual).toBe(true);
    expect(scriptBlocksFromHtml(html)[0].dual).toBe(true);
    expect(withDual(withDual(html, false), true)).toBe(
      '<p data-sp="character" data-block-id="b1" data-sp-dual="1">JONAH</p>'
    );
    expect(withDual(html, false)).toBe('<p data-sp="character" data-block-id="b1">JONAH</p>');
    expect(withElement(html, "dialogue")).toBe('<p data-block-id="b1" data-sp="dialogue">JONAH</p>');
    expect(withElement(html, "character")).toContain('data-sp-dual="1"');
    // Only a cue carries it.
    expect(styledBlocksFromHtml('<p data-sp="dialogue" data-sp-dual="1">Hi</p>')[0].dual).toBeUndefined();
  });
});

describe("(MORE) and (CONT'D)", () => {
  /** A script whose speech breaks across pages: `before` filler lines, a cue, then dialogue of `lines` lines. */
  function speech(before: number, lines: number, extra: ScriptBlock[] = []): ScriptBlock[] {
    return [
      ...Array.from({ length: before }, (_, i) => block("action", `Filler ${i}.`)),
      block("character", "mara"),
      block("dialogue", dialogueLines(lines)),
      ...extra,
    ];
  }

  it("closes the page with (MORE) and opens the next with the cue and (CONT'D)", () => {
    // 20 filler blocks take 39 lines (20 + 19 blanks); cue at 40 (blank + 1), dialogue starts at 41.
    const set = typesetSequences([speech(20, 20)]);
    expect(set.pages).toHaveLength(2);
    const [one, two] = set.pages;
    expect(one).toHaveLength(PAGE_LINES);
    const last = one[one.length - 1]!;
    expect(last).toMatchObject({ text: "(MORE)", indent: 22, synthetic: "more" });
    const top = two[0]!;
    expect(top).toMatchObject({ text: "MARA (CONT'D)", indent: 22, synthetic: "contd" });
    // The dialogue sits directly under the repeated cue, with no blank line between.
    expect(two[1]?.text).toMatch(/^line/);
    expect(set.paginations[0].breaks[0]).toMatchObject({ more: true, contd: true, speech: 20 });
  });

  it("takes the two lines out of the room the speech had: more of it moves to the next page", () => {
    const on = typesetSequences([speech(20, 20)]);
    const off = typesetSequences([speech(20, 20)], { more: false, contd: false });
    const dialogueOn = on.pages[0].filter((r) => r?.text.startsWith("line")).length;
    const dialogueOff = off.pages[0].filter((r) => r?.text.startsWith("line")).length;
    expect(dialogueOn).toBe(dialogueOff - 1);
    expect(off.pages[0].every((r) => r?.synthetic === undefined)).toBe(true);
    expect(off.pages[1][0]?.text).toMatch(/^line/);
  });

  it("can set only (MORE), or only (CONT'D)", () => {
    const moreOnly = typesetSequences([speech(20, 20)], { more: true, contd: false });
    expect(moreOnly.pages[0].at(-1)?.text).toBe("(MORE)");
    expect(moreOnly.pages[1][0]?.text).toMatch(/^line/);
    const contdOnly = typesetSequences([speech(20, 20)], { more: false, contd: true });
    expect(contdOnly.pages[0].at(-1)?.text).toMatch(/^line/);
    expect(contdOnly.pages[1][0]?.text).toBe("MARA (CONT'D)");
  });

  it("adds (CONT'D) to a cue once, and keeps an extension before it", () => {
    expect(contdCue("mara")).toBe("MARA (CONT'D)");
    expect(contdCue("mara (v.o.)")).toBe("MARA (V.O.) (CONT'D)");
    expect(contdCue("mara (cont'd)")).toBe("MARA (CONT'D)");
    expect(contdCue("MARA (CONT’D)")).toBe("MARA (CONT’D)");
  });

  it("does not mark a break inside action, or one that falls between speeches", () => {
    const blocks = [...filler(27), block("action", words(120))];
    const { pagination } = typeset(blocks);
    expect(pagination.breaks.length).toBeGreaterThan(0);
    expect(pagination.breaks.every((b) => !b.more && !b.contd && b.speech === null)).toBe(true);
  });

  it("marks a break between two blocks of one speech", () => {
    // cue + 3 lines + a blank + more dialogue: fill so the second block starts on the next page.
    const blocks: ScriptBlock[] = [
      ...filler(24), // 47 lines
      block("character", "mara"), // blank + 1 = 49
      block("dialogue", dialogueLines(3)), // 52
      block("dialogue", dialogueLines(4)), // 4 + blank would need 57 -> next page
    ];
    const set = typesetSequences([blocks]);
    expect(set.pages).toHaveLength(2);
    expect(set.pages[0].at(-1)).toMatchObject({ text: "(MORE)", synthetic: "more" });
    expect(set.pages[1][0]).toMatchObject({ text: "MARA (CONT'D)" });
    // The block under a repeated cue is directly under it.
    expect(set.pages[1][1]?.text).toMatch(/^line/);
  });

  it("does not leave a page full when a speech goes on: (MORE) always has its line", () => {
    for (let before = 0; before < 40; before++) {
      for (let lines = 1; lines < 14; lines++) {
        const set = typesetSequences([speech(before, lines, [block("dialogue", dialogueLines(3))])]);
        for (const page of set.pages) expect(page.length).toBeLessThanOrEqual(PAGE_LINES);
      }
    }
  });

  it("never strands a cue or a scene heading at the foot of a page", () => {
    for (let before = 0; before < 40; before++) {
      for (let lines = 1; lines < 8; lines++) {
        for (const lead of ["character", "scene-heading"] as const) {
          const blocks =
            lead === "character"
              ? speech(before, lines)
              : [...filler(before), block("scene-heading", "int. lab - day"), block("action", dialogueLines(lines))];
          const set = typesetSequences([blocks]);
          for (const page of set.pages.slice(0, -1)) {
            const last = [...page].reverse().find((r) => r);
            expect(last?.text).not.toBe("MARA");
            expect(last?.text).not.toBe("INT. LAB - DAY");
          }
        }
      }
    }
  });

  it("starts every page on a text row, never a blank line", () => {
    const blocks = Array.from({ length: 30 }, (_, i) => [
      block("scene-heading", `int. place ${i} - day`),
      block("action", words(30 + (i % 7) * 5)),
      block("character", "mara"),
      block("parenthetical", "softly"),
      block("dialogue", dialogueLines(2 + (i % 9))),
      block("dialogue", dialogueLines(1 + (i % 4))),
    ]).flat();
    for (const options of [{}, { more: false }, { contd: false }, { more: false, contd: false }]) {
      const set = typesetSequences([blocks], options);
      for (const page of set.pages) {
        expect(page[0]).not.toBeNull();
        expect(page.length).toBeLessThanOrEqual(PAGE_LINES);
      }
      // The engine's count and the typeset pages agree.
      expect(set.pages).toHaveLength(set.count);
    }
  });

  it("agrees with the page count the editor reads from chapter HTML", () => {
    const html = speech(20, 20)
      .map((b) => (b.element === "action" ? `<p>${b.text}</p>` : `<p data-sp="${b.element}">${b.text}</p>`))
      .join("");
    expect(estimatePages([html])).toBe(2);
    expect(estimatePages([html], { more: false, contd: false })).toBe(2);
    expect(sequenceCursors([html]).end).toEqual(paginate(layout(scriptBlocksFromHtml(html))).end);
  });
});

describe("scene numbers", () => {
  const blocks: ScriptBlock[] = [
    block("scene-heading", "int. lab - day"),
    block("action", "Quiet."),
    block("scene-heading", ""),
    block("scene-heading", "ext. roof - night"),
  ];

  it("numbers headings with words in them, counting on across sequences", () => {
    const set = typesetSequences([blocks, blocks], { sceneNumbers: true });
    const numbers = set.pages.flat().flatMap((r) => (r?.sceneNumber ? [r.sceneNumber] : []));
    expect(numbers).toEqual(["1", "2", "3", "4"]);
    expect(sequenceCursors(["<p data-sp='scene-heading'>a</p><p data-sp='scene-heading'>b</p>", "<p>x</p>"]).scenesBefore).toEqual([0, 2]);
  });

  it("carries no numbers unless asked", () => {
    const set = typesetSequences([blocks]);
    expect(set.pages.flat().every((r) => !r?.sceneNumber)).toBe(true);
    const text = pagesAsText(typesetSequences([blocks], { sceneNumbers: true }).pages, { sceneNumbers: true })[0].split("\n");
    expect(text[0]).toMatch(/^1 {4}INT\. LAB - DAY {2,}1$/);
  });
});

describe("script settings", () => {
  it("reads nothing, junk and a newer client's keys as the defaults", () => {
    expect(parseScriptSettings("")).toEqual(DEFAULT_SCRIPT_SETTINGS);
    expect(parseScriptSettings("not json")).toEqual(DEFAULT_SCRIPT_SETTINGS);
    expect(parseScriptSettings(null)).toEqual(DEFAULT_SCRIPT_SETTINGS);
    expect(parseScriptSettings('{"more":"yes","future":1}')).toEqual(DEFAULT_SCRIPT_SETTINGS);
  });

  it("stores nothing for the defaults, and round-trips anything else", () => {
    expect(serializeScriptSettings(DEFAULT_SCRIPT_SETTINGS)).toBe("");
    const settings = parseScriptSettings({
      titlePage: { title: "  Night   Shift ", contact: "Jo\r\n  12 Main St  \n\n\nnow@example.com", draftDate: "Oct 2026" },
      more: false,
      sceneNumbers: true,
    });
    expect(settings.titlePage.title).toBe("Night Shift");
    expect(settings.titlePage.contact).toBe("Jo\n12 Main St\n\nnow@example.com");
    expect(settings).toMatchObject({ more: false, contd: true, showTitlePage: true, sceneNumbers: true });
    expect(parseScriptSettings(serializeScriptSettings(settings))).toEqual(settings);
  });

  it("cuts a field to its limit", () => {
    expect(parseScriptSettings({ titlePage: { title: "x".repeat(500) } }).titlePage.title).toHaveLength(200);
  });

  it("falls back to the manuscript's title and author, and credits an author", () => {
    const resolved = resolveTitlePage(DEFAULT_SCRIPT_SETTINGS.titlePage, { title: "Night Shift", author: "Jo Writer" });
    expect(resolved).toMatchObject({ title: "Night Shift", credit: "Written by", author: "Jo Writer" });
    const own = resolveTitlePage(
      { ...DEFAULT_SCRIPT_SETTINGS.titlePage, title: "Day Shift", credit: "Screenplay by", author: "A. Writer" },
      { title: "Night Shift", author: "Jo Writer" }
    );
    expect(own).toMatchObject({ title: "Day Shift", credit: "Screenplay by", author: "A. Writer" });
    expect(resolveTitlePage(DEFAULT_SCRIPT_SETTINGS.titlePage, { title: "T", author: "" }).credit).toBe("");
  });
});
