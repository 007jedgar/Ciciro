import { describe, expect, it } from "vitest";
import {
  ELEMENT_MARK,
  classifyReplacement,
  classifyScreenplayLines,
  assistantTextToHtml,
  drafterDirective,
  kindDirective,
  markedLine,
  parseScriptLines,
  scriptDisplayText,
} from "@/lib/manuscript-kind";
import { SCREENPLAY_ELEMENTS, elementOfHtml, scriptBlocksFromHtml, type ScriptBlock } from "@/lib/screenplay";
import { lastScriptElement, scriptTail, scriptTextOfBlocks, scriptTextOfHtml } from "@/lib/script-view";
import { NIGHT_SHIFT } from "./fixtures/screenplay/night-shift";
import * as mobileKind from "../apps/mobile/lib/manuscript-kind";

const rows = (text: string, after?: Parameters<typeof parseScriptLines>[1]) =>
  parseScriptLines(text, after).map((l) => [l.element, l.text]);

describe("marked script lines", () => {
  it("reads a mark as the element it forces", () => {
    expect(
      rows(
        [
          ".INT. LAB - DAY",
          "!Mara enters.",
          "@MARA",
          "(whispering)",
          "He left.",
          ">CUT TO:",
          "^CLOSE ON THE KNIFE",
        ].join("\n")
      )
    ).toEqual([
      ["scene-heading", "INT. LAB - DAY"],
      ["action", "Mara enters."],
      ["character", "MARA"],
      ["parenthetical", "whispering"],
      ["dialogue", "He left."],
      ["transition", "CUT TO:"],
      ["shot", "CLOSE ON THE KNIFE"],
    ]);
  });

  it("keeps an all-caps action line action, the misfire the plain classifier has", () => {
    expect(classifyScreenplayLines("BOOM.\nShe flinches and ducks.").map((l) => l.element)).toEqual([
      "character",
      "dialogue",
    ]);
    expect(rows("!BOOM.\n!She flinches and ducks.")).toEqual([
      ["action", "BOOM."],
      ["action", "She flinches and ducks."],
    ]);
    expect(rows("@MARA\nHello?\n\n!SHE RUNS OUT.")).toEqual([
      ["character", "MARA"],
      ["dialogue", "Hello?"],
      ["action", "SHE RUNS OUT."],
    ]);
  });

  it("keeps an unusual cue a cue and an odd heading a heading", () => {
    expect(rows("@McCLANE (V.O.)\nYippee.\n.EXT. NOWHERE")).toEqual([
      ["character", "McCLANE (V.O.)"],
      ["dialogue", "Yippee."],
      ["scene-heading", "EXT. NOWHERE"],
    ]);
  });

  it("never guesses a new cue from capitals inside a marked speech", () => {
    // Plain classification reads STOP. as a second speaker; a marked script knows it is the line.
    expect(classifyScreenplayLines("MARA\nWait.\nSTOP.").map((l) => l.element)).toEqual([
      "character",
      "dialogue",
      "character",
    ]);
    expect(rows("@MARA\nWait.\nSTOP.\nNO MORE.")).toEqual([
      ["character", "MARA"],
      ["dialogue", "Wait."],
      ["dialogue", "STOP."],
      ["dialogue", "NO MORE."],
    ]);
  });

  it("ends a speech at a blank line", () => {
    expect(rows("@MARA\nHello.\n\nShe turns away.")).toEqual([
      ["character", "MARA"],
      ["dialogue", "Hello."],
      ["action", "She turns away."],
    ]);
  });

  it("falls back to the plain classifier for a line with no mark outside a speech", () => {
    expect(rows(".INT. LAB - DAY\nMara enters.\nMARA\nWhere is he?\nCUT TO:")).toEqual([
      ["scene-heading", "INT. LAB - DAY"],
      ["action", "Mara enters."],
      ["character", "MARA"],
      ["dialogue", "Where is he?"],
      ["transition", "CUT TO:"],
    ]);
  });

  it("is exactly the plain classifier for text with no marks at all", () => {
    for (const text of [
      "INT. KITCHEN - NIGHT\n\nMara stares.\n\nMARA\n(quietly)\nHe never called.\n\nCUT TO:",
      "BOOM.\nShe flinches.",
      "MARA\nSTOP.\nGO.",
    ]) {
      for (const after of [undefined, "character", "dialogue", "action"] as const) {
        expect(parseScriptLines(text, after)).toEqual(classifyScreenplayLines(text, after));
      }
    }
  });

  it("reads on from the element before, until a mark or a blank line says otherwise", () => {
    expect(rows("Hi there.\n!She smiles.", "character")).toEqual([
      ["dialogue", "Hi there."],
      ["action", "She smiles."],
    ]);
    expect(rows("!She smiles.\nHi there.", "character")).toEqual([
      ["action", "She smiles."],
      ["action", "Hi there."],
    ]);
    expect(rows("(softly)\nHi.\n@JON\nHey.", "character")).toEqual([
      ["parenthetical", "softly"],
      ["dialogue", "Hi."],
      ["character", "JON"],
      ["dialogue", "Hey."],
    ]);
  });

  it("does not mistake prose for a mark", () => {
    expect(markedLine("...and then nothing")).toBeNull();
    expect(markedLine(".5 seconds later")).toBeNull();
    expect(markedLine("!!")).toBeNull();
    expect(markedLine("@")).toBeNull();
    expect(markedLine("> ")).toBeNull();
    expect(markedLine("MARA")).toBeNull();
    expect(markedLine(".INT. LAB")).toEqual({ element: "scene-heading", text: "INT. LAB" });
    expect(markedLine("  ! Mara enters.  ")).toEqual({ element: "action", text: "Mara enters." });
    // Fountain's centered line is only a line of action here.
    expect(markedLine("> THE END <")).toEqual({ element: "action", text: "THE END" });
    expect(rows("...and then nothing")).toEqual([["action", "...and then nothing"]]);
  });

  it("returns a parenthetical without its brackets and never an empty one", () => {
    expect(rows("@MARA\n(to herself)\n()\nHi.")).toEqual([
      ["character", "MARA"],
      ["parenthetical", "to herself"],
      ["dialogue", "()"],
      ["dialogue", "Hi."],
    ]);
  });

  it("drops the marks for the author to read", () => {
    expect(scriptDisplayText(".INT. LAB - DAY\n!BOOM.\n@MARA\n(whispering)\nHello.\n>CUT TO:")).toBe(
      "INT. LAB - DAY\nBOOM.\nMARA\n(whispering)\nHello.\nCUT TO:"
    );
    const plain = "Mara enters.\n\n.5 seconds";
    expect(scriptDisplayText(plain)).toBe(plain);
  });

  it("places a marked draft as tagged blocks, read on from the block above", () => {
    const html = assistantTextToHtml("Where is he?\n!BOOM.\n^ANGLE ON THE DOOR", "screenplay", "character");
    expect(html).toBe(
      '<p data-sp="dialogue">Where is he?</p><p>BOOM.</p><p data-sp="shot">ANGLE ON THE DOOR</p>'
    );
    expect(scriptBlocksFromHtml(html).map((b) => b.element)).toEqual(["dialogue", "action", "shot"]);
    // A novel is not touched by any of this.
    expect(assistantTextToHtml("!Boom.\n\n@Next", "novel")).toBe("<p>!Boom.</p><p>@Next</p>");
  });

  it("honors a mark on the first line of a replacement over the element it replaces", () => {
    expect(classifyReplacement("!He looks away.", "shot")).toEqual([{ element: "action", text: "He looks away." }]);
    // A plain line takes the kept element, as before.
    expect(classifyReplacement("CLOSE ON HIS HANDS", "shot")).toEqual([{ element: "shot", text: "CLOSE ON HIS HANDS" }]);
    expect(classifyReplacement("Hi.\n@MARA\nHey.", "dialogue")).toEqual([
      { element: "dialogue", text: "Hi." },
      { element: "character", text: "MARA" },
      { element: "dialogue", text: "Hey." },
    ]);
  });
});

describe("a script as the assistant reads it", () => {
  const html = (blocks: ScriptBlock[]) =>
    blocks
      .map((b) => `<p${b.element === "action" ? "" : ` data-sp="${b.element}"`}>${b.text}</p>`)
      .join("");

  it("marks each line with its element and keeps a speech together", () => {
    expect(
      scriptTextOfBlocks([
        { element: "scene-heading", text: "INT. LAB - DAY" },
        { element: "action", text: "BOOM." },
        { element: "character", text: "MARA" },
        { element: "parenthetical", text: "whispering" },
        { element: "dialogue", text: "He left." },
        { element: "dialogue", text: "Just like that." },
        { element: "transition", text: "CUT TO:" },
        { element: "shot", text: "CLOSE ON THE DOOR" },
      ])
    ).toBe(
      [
        ".INT. LAB - DAY",
        "",
        "!BOOM.",
        "",
        "@MARA",
        "(whispering)",
        "He left.",
        "Just like that.",
        "",
        ">CUT TO:",
        "",
        "^CLOSE ON THE DOOR",
      ].join("\n")
    );
  });

  it("shows text as stored, so what the model finds is what is there", () => {
    expect(scriptTextOfBlocks([{ element: "scene-heading", text: "int. lab - day" }])).toBe(".int. lab - day");
  });

  it("leaves out an empty block, shows an unknown element as action, and flattens a hard break", () => {
    expect(
      scriptTextOfBlocks([
        { element: "scene-heading", text: "" },
        { element: "centered", text: "THE END" },
        { element: "action", text: "One\nTwo" },
      ])
    ).toBe("!THE END\n\n!One Two");
  });

  it("round-trips the whole fixture: reading it back gives the same elements and words", () => {
    const text = scriptTextOfBlocks(NIGHT_SHIFT);
    expect(parseScriptLines(text).map(({ element, text: t }) => ({ element, text: t }))).toEqual(NIGHT_SHIFT);
    // And through chapter HTML, the way read_chapter gets it.
    expect(scriptTextOfHtml(html(NIGHT_SHIFT))).toBe(text);
  });

  it("round-trips every element on its own and a cue with no dialogue", () => {
    for (const element of SCREENPLAY_ELEMENTS) {
      const blocks: ScriptBlock[] = [{ element, text: "Some words here" }];
      const parsed = parseScriptLines(scriptTextOfBlocks(blocks));
      // A lone dialogue or parenthetical has no cue to sit under; the page reads it as action.
      if (element === "dialogue") expect(parsed).toEqual([{ element: "action", text: "Some words here" }]);
      else if (element === "parenthetical") expect(parsed).toEqual([{ element: "action", text: "(Some words here)" }]);
      else expect(parsed).toEqual(blocks);
    }
    const cueOnly: ScriptBlock[] = [
      { element: "character", text: "MARA" },
      { element: "scene-heading", text: "INT. LAB - DAY" },
    ];
    expect(parseScriptLines(scriptTextOfBlocks(cueOnly))).toEqual(cueOnly);
  });

  it("hands the drafter the last few elements to pick up from, and the element they leave open", () => {
    const blocks: ScriptBlock[] = [
      { element: "scene-heading", text: "INT. LAB - DAY" },
      { element: "action", text: "Mara waits." },
      { element: "character", text: "MARA" },
    ];
    expect(scriptTail(html(blocks), 2)).toBe("!Mara waits.\n\n@MARA");
    expect(lastScriptElement(html(blocks))).toBe("character");
    expect(lastScriptElement("")).toBeUndefined();
    expect(lastScriptElement('<p data-sp="scene-heading"></p>')).toBeUndefined();
    expect(elementOfHtml(assistantTextToHtml("Hi.", "screenplay", lastScriptElement(html(blocks))))).toBe("dialogue");
  });

  it("tells the assistant the format it reads and writes, in one place", () => {
    for (const text of [kindDirective("screenplay"), drafterDirective("screenplay")]) {
      for (const element of Object.keys(ELEMENT_MARK)) {
        expect(text).toContain(ELEMENT_MARK[element as keyof typeof ELEMENT_MARK]);
      }
      expect(text).toContain(".INT. KITCHEN - NIGHT");
      expect(text).toContain("^CLOSE ON THE KNIFE");
    }
    expect(kindDirective("screenplay")).toContain("passage id (chN.sK) is a scene");
  });
});

describe("the phone parses marked lines the same way", () => {
  it("agrees on every case above", () => {
    const scripts = [
      ".INT. LAB - DAY\n!Mara enters.\n@MARA\n(whispering)\nHe left.\n>CUT TO:\n^CLOSE ON THE KNIFE",
      "!BOOM.\n!She flinches and ducks.",
      "@MARA\nWait.\nSTOP.\n\n!SHE RUNS OUT.",
      "INT. LAB - DAY\nMara enters.\nMARA\nWhere is he?\nCUT TO:",
      "...and then nothing\n.5 seconds\n!!\n> THE END <",
      "Hi there.\n!She smiles.",
    ];
    for (const script of scripts) {
      for (const after of [undefined, "character", "dialogue", "action"] as const) {
        expect(mobileKind.parseScriptLines(script, after)).toEqual(parseScriptLines(script, after));
      }
      expect(mobileKind.scriptDisplayText(script)).toBe(scriptDisplayText(script));
      for (const line of script.split("\n")) expect(mobileKind.markedLine(line)).toEqual(markedLine(line));
    }
    expect(mobileKind.ELEMENT_MARK).toEqual(ELEMENT_MARK);
  });
});
