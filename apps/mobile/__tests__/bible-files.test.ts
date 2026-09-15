import {
  bibleFileGroup,
  bibleFileHref,
  bibleFileLabel,
  biblePathFromParam,
  groupBibleEntries,
  withCoreBibleFiles,
} from "../lib/bible-files";

describe("bible files", () => {
  it("labels core files and nested slugs for the list", () => {
    expect(bibleFileLabel("canon.md")).toBe("Canon");
    expect(bibleFileLabel("characters/ada-lovelace.md")).toBe("Ada Lovelace");
    expect(bibleFileLabel("plot/the-heist.md")).toBe("The Heist");
  });

  it("groups core files, characters, and plot lines", () => {
    const grouped = groupBibleEntries([
      { path: "canon.md", summary: "Facts" },
      { path: "characters/ada.md", summary: "Ada" },
      { path: "plot.md", summary: "Overview" },
      { path: "plot/the-heist.md", summary: "A theft" },
      { path: "notes.md", summary: "Odds" },
    ]);
    expect(grouped.core.map((e) => e.path)).toEqual(["canon.md", "plot.md"]);
    expect(grouped.characters.map((e) => e.path)).toEqual(["characters/ada.md"]);
    expect(grouped.plotLines.map((e) => e.path)).toEqual(["plot/the-heist.md"]);
    expect(grouped.other.map((e) => e.path)).toEqual(["notes.md"]);
    expect(bibleFileGroup("world.md")).toBe("core");
  });

  it("always includes the five starter files even when the server list is empty", () => {
    const merged = withCoreBibleFiles([], "(empty)");
    expect(merged.map((e) => e.path)).toEqual([
      "canon.md",
      "plot.md",
      "style.md",
      "timeline.md",
      "world.md",
    ]);
    expect(merged[0]?.summary).toBe("(empty)");
  });

  it("builds and parses nested bible routes", () => {
    expect(bibleFileHref("p1", "characters/ada.md")).toBe(
      "/project/p1/bible/characters/ada.md"
    );
    expect(biblePathFromParam(["characters", "ada.md"])).toBe("characters/ada.md");
    expect(biblePathFromParam("canon.md")).toBe("canon.md");
  });
});
