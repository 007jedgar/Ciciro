import { Fountain } from "fountain-js";
import { describe, expect, it } from "vitest";
import {
  fountainFromScript,
  looksLikeFountain,
  runsFromFountain,
  scriptBlocksToHtml,
  scriptFromFountain,
} from "@/lib/fountain";
import { estimatePages, runsText, styledBlocksFromHtml, type StyledBlock } from "@/lib/screenplay";
import { longScript } from "./fixtures/screenplay/long-script";

const block = (element: string, text: string): StyledBlock => ({ element, runs: [{ text }] });
const write = (...blocks: StyledBlock[]) => fountainFromScript({ title: "", author: "", sequences: [{ title: "", blocks }] });
const read = (text: string) => scriptFromFountain(text).sequences.flatMap((s) => s.blocks);
const shape = (blocks: StyledBlock[]) => blocks.map((b) => [b.element, runsText(b.runs)]);

describe("writing Fountain", () => {
  it("writes capitals at the edge and one blank line between elements", () => {
    expect(
      write(
        block("scene-heading", "int. lab - day"),
        block("action", "She waits."),
        block("character", "mara"),
        block("parenthetical", "softly"),
        block("dialogue", "Hello."),
        block("transition", "cut to:")
      )
    ).toBe("INT. LAB - DAY\n\nShe waits.\n\nMARA\n(softly)\nHello.\n\nCUT TO:\n");
  });

  it("forces the markers a plain line would lose", () => {
    const text = write(
      block("scene-heading", "the hallway"),
      block("action", "BOOM."),
      block("action", "INT. is how it starts"),
      block("character", "mc donald-2"),
      block("dialogue", "Hi."),
      block("character", "123"),
      block("dialogue", "Numbers."),
      block("transition", "fade in:"),
      block("shot", "close on the door"),
      block("action", "SHE RUNS.\nHE FOLLOWS.")
    );
    expect(text).toBe(
      [
        ".THE HALLWAY",
        "!BOOM.",
        "!INT. is how it starts",
        "MC DONALD-2\nHi.",
        "@123\nNumbers.",
        ">FADE IN:",
        "!CLOSE ON THE DOOR",
        "!SHE RUNS.\nHE FOLLOWS.",
      ].join("\n\n") + "\n"
    );
  });

  it("writes emphasis, with spaces outside the delimiters", () => {
    const text = fountainFromScript({
      title: "",
      author: "",
      sequences: [
        {
          title: "",
          blocks: [
            {
              element: "action",
              runs: [
                { text: "A " },
                { text: "bold move ", bold: true },
                { text: "and ", italic: true, underline: true },
                { text: "star * and snake_case" },
              ],
            },
          ],
        },
      ],
    });
    expect(text).toBe("A **bold** **move** _*and*_ star \\* and snake\\_case\n");
  });

  it("writes sections for more than one sequence, and a title block", () => {
    const text = fountainFromScript({
      title: "Night Shift",
      author: "A. Writer",
      sequences: [
        { title: "Act one", blocks: [block("action", "One.")] },
        { title: "", blocks: [block("action", "Two.")] },
      ],
    });
    expect(text).toBe("Title: Night Shift\nAuthor: A. Writer\n\n# Act one\n\nOne.\n\n# Sequence 2\n\nTwo.\n");
  });

  it("skips empty blocks and writes nothing for an empty script", () => {
    expect(write(block("scene-heading", ""), block("action", " "))).toBe("");
  });

  it("keeps a cue with nothing under it readable", () => {
    expect(write(block("character", "mara"))).toBe("@MARA\n");
    expect(shape(read("@MARA\n"))).toEqual([["character", "MARA"]]);
  });

  it("separates two lines of dialogue in one speech with a line of two spaces", () => {
    const text = write(block("character", "mara"), block("dialogue", "One."), block("dialogue", "Two."));
    expect(text).toBe("MARA\nOne.\n  \nTwo.\n");
    expect(shape(read(text))).toEqual([
      ["character", "MARA"],
      ["dialogue", "One."],
      ["dialogue", "Two."],
    ]);
  });
});

describe("reading Fountain", () => {
  it("reads every element, with and without forced markers", () => {
    const blocks = read(
      [
        "INT. LAB - DAY #12#",
        "She waits.",
        "!BOOM.",
        "@mc donald\n(beat)\nHi there.",
        ".THE HALLWAY",
        ">FADE IN:",
        "CUT TO:",
        "> THE END <",
        "!CLOSE ON THE DOOR",
      ].join("\n\n")
    );
    expect(shape(blocks)).toEqual([
      ["scene-heading", "INT. LAB - DAY"],
      ["action", "She waits."],
      ["action", "BOOM."],
      ["character", "mc donald"],
      ["parenthetical", "beat"],
      ["dialogue", "Hi there."],
      ["scene-heading", "THE HALLWAY"],
      ["transition", "FADE IN:"],
      ["transition", "CUT TO:"],
      ["action", "THE END"],
      ["shot", "CLOSE ON THE DOOR"],
    ]);
  });

  it("reads a parenthetical and dialogue under a cue, and strips the dual-dialogue mark", () => {
    expect(shape(read("MARA ^\n(softly)\nHello.\nStill me.\n(beat)\nOkay."))).toEqual([
      ["character", "MARA"],
      ["parenthetical", "softly"],
      ["dialogue", "Hello.\nStill me."],
      ["parenthetical", "beat"],
      ["dialogue", "Okay."],
    ]);
  });

  it("reads a line of capitals with nothing under it as action", () => {
    expect(shape(read("BOOM.\n\nShe flinches."))).toEqual([
      ["action", "BOOM."],
      ["action", "She flinches."],
    ]);
  });

  it("drops notes, the boneyard, synopses and page breaks, and keeps the text around them", () => {
    const blocks = read(
      "A line [[a note]] goes on.\n\n[[whole note]]\n\n/* boned\nyard */\n\n= a synopsis\n\n===\n\nNext."
    );
    expect(shape(blocks)).toEqual([
      ["action", "A line  goes on."],
      ["action", "Next."],
    ]);
  });

  it("reads the title and author out of a title block", () => {
    const script = scriptFromFountain("Title:\n\t_**BRICK & STEEL**_\n\t_**FULL RIDE**_\nCredit: Written by\nAuthor: Stu Maschwitz\nContact: x@y.z\n\nINT. HOUSE - DAY\n\nHi.");
    expect(script.title).toBe("BRICK & STEEL FULL RIDE");
    expect(script.author).toBe("Stu Maschwitz");
    expect(script.sequences[0].blocks).toHaveLength(2);
  });

  it("does not take an ordinary first line for a title block", () => {
    const script = scriptFromFountain("INT. HOUSE: DAY\n\nHi.");
    expect(script.title).toBe("");
    expect(script.sequences[0].blocks).toHaveLength(2);
  });

  it("splits sequences at the shallowest section, and uses one when there are none", () => {
    const sectioned = scriptFromFountain(
      "Opening text.\n\n# ACT ONE\n\n## Sequence A\n\nINT. A - DAY\n\n# ACT TWO\n\nEXT. B - NIGHT\n\n## Sequence C\n\nDone."
    );
    expect(sectioned.sequences.map((s) => [s.title, s.blocks.length])).toEqual([
      ["", 1],
      ["ACT ONE", 1],
      ["ACT TWO", 2],
    ]);
    const deeper = scriptFromFountain("## One\n\nA.\n\n### Not a split\n\nB.\n\n## Two\n\nC.");
    expect(deeper.sequences.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(scriptFromFountain("INT. A - DAY\n\nHi.").sequences).toHaveLength(1);
    expect(scriptFromFountain("").sequences).toEqual([{ title: "", blocks: [] }]);
  });

  it("reads emphasis and escapes", () => {
    expect(runsFromFountain("A **bold** and *it* and _under_ and ***both***.")).toEqual([
      { text: "A " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "it", italic: true },
      { text: " and " },
      { text: "under", underline: true },
      { text: " and " },
      { text: "both", bold: true, italic: true },
      { text: "." },
    ]);
    expect(runsFromFountain("snake_case and 2 * 3 and \\*literal\\*")).toEqual([{ text: "snake_case and 2 * 3 and *literal*" }]);
    expect(runsFromFountain("**unclosed")).toEqual([{ text: "**unclosed" }]);
  });

  it("reads Windows line endings and a byte order mark", () => {
    expect(shape(read("﻿INT. A - DAY\r\n\r\nHi.\r\n"))).toEqual([
      ["scene-heading", "INT. A - DAY"],
      ["action", "Hi."],
    ]);
  });

  it("makes chapter HTML with the element on each paragraph", () => {
    const html = scriptBlocksToHtml(read("INT. A - DAY\n\nMARA\nHi *there* & <you>."));
    expect(html).toBe(
      '<p data-sp="scene-heading">INT. A - DAY</p><p data-sp="character">MARA</p><p data-sp="dialogue">Hi <em>there</em> &amp; &lt;you&gt;.</p>'
    );
  });

  it("tells a laid-out script from a run of lines", () => {
    expect(looksLikeFountain("INT. A - DAY\n\nHi.")).toBe(true);
    expect(looksLikeFountain("INT. A - DAY\nHi.")).toBe(false);
    expect(looksLikeFountain("one line")).toBe(false);
  });
});

describe("a thirty page script", () => {
  const sequences = longScript(30);
  const html = sequences.map((s) => scriptBlocksToHtmlOf(s.blocks));
  function scriptBlocksToHtmlOf(blocks: StyledBlock[]) {
    return scriptBlocksToHtml(blocks);
  }

  it("is about thirty pages", () => {
    const pages = estimatePages(html);
    expect(pages).toBeGreaterThanOrEqual(26);
    expect(pages).toBeLessThanOrEqual(36);
  });

  it("round trips from export to import without losing an element", () => {
    const text = fountainFromScript({ title: "Night Shift", author: "A. Writer", sequences });
    const back = scriptFromFountain(text);
    expect(back.title).toBe("Night Shift");
    expect(back.author).toBe("A. Writer");
    expect(back.sequences.map((s) => s.title)).toEqual(sequences.map((s) => s.title));
    sequences.forEach((sequence, i) => {
      const want = sequence.blocks.map((b) => [b.element, runsText(b.runs)]);
      // Capitals are derived at the edge; everything else comes back as typed.
      const got = back.sequences[i].blocks.map((b) => [b.element, runsText(b.runs)]);
      expect(got).toEqual(
        want.map(([element, text]) =>
          ["scene-heading", "character", "transition", "shot"].includes(element) ? [element, text.toUpperCase()] : [element, text]
        )
      );
    });
    // And the pages are the same pages.
    expect(estimatePages(back.sequences.map((s) => scriptBlocksToHtml(s.blocks)))).toBe(estimatePages(html));
  });

  it("keeps bold, italic and underline through the round trip", () => {
    const text = fountainFromScript({ title: "", author: "", sequences });
    const back = scriptFromFountain(text).sequences.flatMap((s) => s.blocks);
    const marks = (blocks: StyledBlock[]) => blocks.flatMap((b) => b.runs.filter((r) => r.bold || r.italic || r.underline));
    expect(marks(back)).toEqual(marks(sequences.flatMap((s) => s.blocks)));
  });

  it("reads back as the same elements the reference parser sees", () => {
    const text = fountainFromScript({ title: "", author: "", sequences });
    const tokens = new Fountain().parse(text, true).tokens;
    const named: Record<string, string> = {
      scene_heading: "scene-heading",
      action: "action",
      character: "character",
      parenthetical: "parenthetical",
      dialogue: "dialogue",
      transition: "transition",
    };
    const theirs = tokens
      .filter((t) => named[t.type])
      .map((t) => named[t.type]);
    // fountain-js has no shot (it sees an action line) and makes one dialogue
    // of the two lines Ciciro keeps as two blocks; fold both before comparing.
    const ours: string[] = [];
    for (const b of sequences.flatMap((s) => s.blocks)) {
      const element = b.element === "shot" ? "action" : b.element;
      if (element === "dialogue" && ours[ours.length - 1] === "dialogue") continue;
      ours.push(element);
    }
    expect(theirs).toEqual(ours);
    expect(tokens.filter((t) => t.type === "section").length).toBe(sequences.length);
  });
});

describe("html round trip", () => {
  it("reads the paragraphs back as the same styled blocks", () => {
    const blocks = longScript(3, 1)[0].blocks;
    const back = styledBlocksFromHtml(scriptBlocksToHtml(blocks));
    expect(back).toEqual(blocks.map((b) => ({ element: b.element === "action" ? "action" : b.element, runs: b.runs })));
  });
});
