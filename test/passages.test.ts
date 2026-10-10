import { describe, expect, it } from "vitest";
import fixture from "./fixtures/malformed-manuscript.json";
import {
  countPassageOccurrences,
  deletePassageRange,
  formatSceneIndex,
  indexChapter,
  normalizePassageComparison,
  renderAnnotatedChapter,
  resolvePassageId,
  splitChapterHtmlAt,
} from "@/lib/passages";
import { htmlToText } from "@/lib/text";

describe("structural passage operations", () => {
  it("splits a fused inline boundary without losing either side", () => {
    const source = fixture.chapters[0].content;
    const split = splitChapterHtmlAt(source, fixture.boundary, 1, 2);
    expect(split).not.toHaveProperty("error");
    if ("error" in split) return;

    expect(normalizePassageComparison(split.sourceContent)).toBe(
      normalizePassageComparison(
        "The hospital improvised a hastily assembled press conference featuring the Surgeon"
      )
    );
    expect(split.destinationContent).not.toContain(fixture.boundary);
    expect(normalizePassageComparison(split.destinationContent)).toContain(
      normalizePassageComparison(fixture.duplicatePassage)
    );
  });

  it("deletes inclusive paragraph ranges and refreshes their index", () => {
    const result = deletePassageRange(
      "<p>Keep this.</p><p>Delete one.</p><p>Delete two.</p><p>Keep that.</p>",
      1,
      "ch1.p2-p3"
    );
    expect(result).not.toHaveProperty("error");
    if ("error" in result) return;

    expect(normalizePassageComparison(result.content)).toBe("keep this. keep that.");
    expect(result.index.paragraphs.map((passage) => passage.id)).toEqual([
      "ch1.p1",
      "ch1.p2",
    ]);
  });

  it("detects normalized duplicates in the destination fixture", () => {
    const destination = fixture.chapters[1].content;
    expect(countPassageOccurrences(destination, fixture.duplicatePassage)).toBe(1);
    expect(
      countPassageOccurrences(
        destination,
        "<p>THE CAMERAS FOUND DR. VALE BEFORE SHE FOUND THE PODIUM.</p> " +
          "<p>She denied the accusation without looking at her notes.</p>"
      )
    ).toBe(1);
  });
});

describe("a script's passages", () => {
  const p = (element: string, text: string, id?: string) =>
    `<p${id ? ` data-block-id="${id}"` : ""}${element === "action" ? "" : ` data-sp="${element}"`}>${text}</p>`;
  const script = [
    p("action", "FADE IN:"),
    p("scene-heading", "int. lab - day"),
    p("action", "Mara waits."),
    p("character", "MARA"),
    p("dialogue", "Where is he?"),
    p("scene-heading", "ext. rooftop - night"),
    p("shot", "CLOSE ON THE PHONE"),
    p("action", "It rings."),
    p("scene-heading", "int. stairwell"),
    p("action", "Boots on steel."),
  ].join("");

  it("starts a scene at each scene heading and names it by the heading", () => {
    const { scenes } = indexChapter(script, 2);
    expect(scenes.map((s) => [s.id, s.gist, s.startIdx, s.endIdx])).toEqual([
      ["ch2.s1", "FADE IN:", 0, 0],
      ["ch2.s2", "INT. LAB - DAY", 1, 4],
      ["ch2.s3", "EXT. ROOFTOP - NIGHT", 5, 7],
      ["ch2.s4", "INT. STAIRWELL", 8, 9],
    ]);
    expect(formatSceneIndex(indexChapter(script, 2))).toContain("- ch2.s3 (10w, p6-p8) EXT. ROOFTOP - NIGHT");
  });

  it("resolves a scene id to the blocks from its heading to the next", () => {
    const run = resolvePassageId(script, 2, "ch2.s2");
    expect(run).not.toHaveProperty("error");
    if ("error" in run) return;
    expect(htmlToText(script.slice(run.start, run.end))).toBe("int. lab - day\n\nMara waits.\n\nMARA\n\nWhere is he?");
    // Deleting a scene by its heading takes the whole scene and leaves the rest.
    const deletion = deletePassageRange(script, 2, "ch2.s3");
    expect(deletion).not.toHaveProperty("error");
    if ("error" in deletion) return;
    expect(htmlToText(deletion.content)).not.toContain("rooftop");
    expect(htmlToText(deletion.content)).toContain("int. stairwell");
    expect(deletion.index.scenes.map((s) => s.gist)).toEqual(["FADE IN:", "INT. LAB - DAY", "INT. STAIRWELL"]);
  });

  it("names an empty heading and keeps an untagged chapter on the scene-break rule", () => {
    expect(indexChapter(p("scene-heading", ""), 1).scenes[0].gist).toBe("(untitled scene)");
    const novel = "<p>One.</p><p>***</p><p>Two.</p>";
    expect(indexChapter(novel, 1).scenes.map((s) => s.id)).toEqual(["ch1.s1", "ch1.s2"]);
    // A chapter with a heading in it is a script even if it also has a lone "***".
    expect(indexChapter(`${p("scene-heading", "int. a")}<p>***</p>${p("action", "x")}`, 1).scenes).toHaveLength(1);
  });

  it("shows a script to the model as marked script lines, scene by scene", () => {
    const text = renderAnnotatedChapter(script, 2, "Sequence 2", { kind: "screenplay" });
    expect(text).toBe(
      [
        "# Sequence 2",
        "",
        "[ch2.s1 · 2w]",
        "!FADE IN:",
        "",
        "[ch2.s2 · 10w]",
        ".int. lab - day",
        "",
        "!Mara waits.",
        "",
        "@MARA",
        "Where is he?",
        "",
        "[ch2.s3 · 10w]",
        ".ext. rooftop - night",
        "",
        "^CLOSE ON THE PHONE",
        "",
        "!It rings.",
        "",
        "[ch2.s4 · 5w]",
        ".int. stairwell",
        "",
        "!Boots on steel.",
      ].join("\n")
    );
    // The same chapter for a novel is plain text, unchanged.
    expect(renderAnnotatedChapter("<p>One.</p><p>Two.</p>", 1)).toBe("[ch1.s1 · 2w]\nOne.\n\nTwo.");
  });
});
