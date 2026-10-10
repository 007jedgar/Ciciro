import { describe, expect, it } from "vitest";
import {
  applyCompletion,
  bibleCharacterNames,
  buildScriptIndex,
  capsText,
  completionsFor,
  continuesSpeech,
  hasExtension,
  moveSceneOrder,
  parseCue,
  parseSceneHeading,
  sceneOutline,
  setsCaps,
  smartTab,
  timesOfDay,
  toggleExtension,
  type ScriptBlock,
} from "@/lib/screenplay";

const b = (element: string, text: string): ScriptBlock => ({ element, text });

describe("typed capitals", () => {
  it("sets the capitals elements in capitals and leaves the rest as typed", () => {
    for (const el of ["scene-heading", "character", "transition", "shot"]) {
      expect(setsCaps(el)).toBe(true);
      expect(capsText(el, "int. lab - día")).toBe("INT. LAB - DÍA");
    }
    for (const el of ["action", "dialogue", "parenthetical", "mystery"]) {
      expect(setsCaps(el)).toBe(false);
      expect(capsText(el, "Mara runs.")).toBe("Mara runs.");
    }
  });

  it("keeps offsets: a letter whose capital is longer stays as it is", () => {
    expect(capsText("character", "straße")).toHaveLength("straße".length);
  });
});

describe("cue extensions", () => {
  it("splits a cue into its name and extensions", () => {
    expect(parseCue("MARA")).toEqual({ name: "MARA", extensions: [] });
    expect(parseCue("MARA (V.O.)")).toEqual({ name: "MARA", extensions: ["V.O."] });
    expect(parseCue("MARA (V.O.) (CONT'D)")).toEqual({ name: "MARA", extensions: ["V.O.", "CONT'D"] });
    expect(parseCue("MARA(O.S.)  ")).toEqual({ name: "MARA", extensions: ["O.S."] });
    expect(parseCue("")).toEqual({ name: "", extensions: [] });
  });

  it("reads an extension however it was typed", () => {
    expect(hasExtension("MARA (v.o.)", "V.O.")).toBe(true);
    expect(hasExtension("MARA (CONT’D)", "CONT'D")).toBe(true);
    expect(hasExtension("MARA", "V.O.")).toBe(false);
  });

  it("toggles an extension on and off", () => {
    expect(toggleExtension("MARA", "V.O.")).toBe("MARA (V.O.)");
    expect(toggleExtension("MARA (V.O.)", "V.O.")).toBe("MARA");
    expect(toggleExtension("MARA", "CONT'D")).toBe("MARA (CONT'D)");
  });

  it("keeps CONT'D last and lets V.O. and O.S. replace one another", () => {
    expect(toggleExtension("MARA (CONT'D)", "V.O.")).toBe("MARA (V.O.) (CONT'D)");
    expect(toggleExtension("MARA (V.O.)", "CONT'D")).toBe("MARA (V.O.) (CONT'D)");
    expect(toggleExtension("MARA (V.O.) (CONT'D)", "O.S.")).toBe("MARA (O.S.) (CONT'D)");
    expect(toggleExtension("MARA (V.O.) (CONT'D)", "CONT'D")).toBe("MARA (V.O.)");
  });

  it("leaves a cue with no name alone", () => {
    expect(toggleExtension("", "V.O.")).toBe("");
    expect(toggleExtension("  ", "CONT'D")).toBe("  ");
  });
});

describe("scene headings", () => {
  it("reads the prefix, the location and the time of day", () => {
    expect(parseSceneHeading("INT. MARA'S KITCHEN - NIGHT")).toMatchObject({
      prefix: "INT.",
      location: "MARA'S KITCHEN",
      separator: true,
      time: "NIGHT",
    });
    expect(parseSceneHeading("EXT./INT. CAR")).toMatchObject({ prefix: "", location: "EXT./INT. CAR" });
    expect(parseSceneHeading("INT./EXT. CAR - DAY")).toMatchObject({ prefix: "INT./EXT.", location: "CAR", time: "DAY" });
  });

  it("splits the time off at the last dash and keeps a hyphenated word whole", () => {
    expect(parseSceneHeading("INT. LAB - BASEMENT - NIGHT")).toMatchObject({ location: "LAB - BASEMENT", time: "NIGHT" });
    expect(parseSceneHeading("EXT. SMITH-JONES HOUSE")).toMatchObject({
      location: "SMITH-JONES HOUSE",
      separator: false,
      time: "",
    });
  });

  it("reads a heading that is still being typed", () => {
    expect(parseSceneHeading("INT.")).toMatchObject({ prefix: "INT.", location: "", separator: false });
    expect(parseSceneHeading("INT. ")).toMatchObject({ prefix: "INT.", location: "", locationAt: 5 });
    expect(parseSceneHeading("INT. LAB -")).toMatchObject({ location: "LAB", separator: true, time: "" });
    expect(parseSceneHeading("INT. LAB - NI")).toMatchObject({ time: "NI", timeAt: 11 });
    expect(parseSceneHeading("INTERIOR LAB").prefix).toBe("");
    expect(parseSceneHeading("").prefix).toBe("");
  });

  it("accepts the other prefixes and any case", () => {
    expect(parseSceneHeading("ext. beach").prefix).toBe("ext.");
    expect(parseSceneHeading("I/E CAR").prefix).toBe("I/E");
    expect(parseSceneHeading("EST. PARIS").prefix).toBe("EST.");
  });

  it("offers Spanish times of day for a Spanish app", () => {
    expect(timesOfDay("es-MX")).toContain("NOCHE");
    expect(timesOfDay("en")).toContain("NIGHT");
    expect(timesOfDay(null)).toContain("DAY");
  });
});

describe("Tab flow", () => {
  it("walks a heading from the prefix to the location to the time of day", () => {
    expect(smartTab("scene-heading", "INT.")).toEqual({ kind: "insert", text: " " });
    expect(smartTab("scene-heading", "INT. LAB")).toEqual({ kind: "insert", text: " - " });
    expect(smartTab("scene-heading", "INT. LAB ")).toEqual({ kind: "insert", text: "- " });
  });

  it("starts the action under a heading that has its time of day", () => {
    expect(smartTab("scene-heading", "INT. LAB - NIGHT")).toEqual({ kind: "line", element: "action" });
    expect(smartTab("scene-heading", "INT. LAB - BASEMENT - NIGHT")).toEqual({ kind: "line", element: "action" });
  });

  it("gives a prefix typed without its dot the dot on the way", () => {
    expect(smartTab("scene-heading", "INT")).toEqual({ kind: "replace", text: "INT. " });
    expect(smartTab("scene-heading", "int/ext")).toEqual({ kind: "replace", text: "INT./EXT. " });
    expect(smartTab("scene-heading", "I/E")).toEqual({ kind: "replace", text: "I/E. " });
    expect(smartTab("scene-heading", "EXT LAB")).toEqual({ kind: "replace", text: "EXT. LAB - " });
    expect(smartTab("scene-heading", "INT", { trailing: false })).toEqual({ kind: "replace", text: "INT." });
    expect(smartTab("scene-heading", "INT LAB - NIGHT")).toEqual({ kind: "line", element: "action" });
  });

  it("lets an unfinished or empty heading fall to the ring", () => {
    expect(smartTab("scene-heading", "")).toBeNull();
    expect(smartTab("scene-heading", "INT. ")).toBeNull();
    expect(smartTab("scene-heading", "INT. LAB - ")).toBeNull();
    expect(smartTab("scene-heading", "LAB")).toBeNull();
  });

  it("goes from a cue with a name to a parenthetical line", () => {
    expect(smartTab("character", "MARA")).toEqual({ kind: "line", element: "parenthetical" });
    expect(smartTab("character", "MARA (V.O.)")).toEqual({ kind: "line", element: "parenthetical" });
    expect(smartTab("character", "")).toBeNull();
    expect(smartTab("character", "   ")).toBeNull();
  });

  it("has no flow for the other elements, or one it does not know", () => {
    for (const el of ["action", "dialogue", "parenthetical", "transition", "shot", "mystery"]) {
      expect(smartTab(el, "Something")).toBeNull();
    }
  });
});

describe("CONT'D", () => {
  const script = [
    b("scene-heading", "INT. LAB - NIGHT"),
    b("character", "MARA"),
    b("dialogue", "Hello."),
    b("action", "She turns away."),
    b("character", "MARA"),
  ];

  it("continues a speech the same character left for some action", () => {
    expect(continuesSpeech(script, 4, "MARA")).toBe(true);
    expect(continuesSpeech(script, 4, "mara (V.O.)")).toBe(true);
  });

  it("does not when someone else spoke last, or nothing came between", () => {
    expect(continuesSpeech(script, 4, "JONAH")).toBe(false);
    expect(continuesSpeech(script.filter((_, i) => i !== 3), 3, "MARA")).toBe(false);
  });

  it("does not across a scene", () => {
    const next = [...script.slice(0, 4), b("scene-heading", "INT. HALL - DAY"), b("action", "Quiet."), b("character", "MARA")];
    expect(continuesSpeech(next, 6, "MARA")).toBe(false);
  });

  it("looks past a parenthetical and an empty action", () => {
    const withParen = [
      b("character", "MARA"),
      b("parenthetical", "softly"),
      b("dialogue", "Hello."),
      b("action", ""),
      b("action", "A door."),
      b("character", "MARA"),
    ];
    expect(continuesSpeech(withParen, 5, "MARA")).toBe(true);
    expect(continuesSpeech(withParen.filter((x) => x.text !== "A door."), 4, "MARA")).toBe(false);
  });

  it("reads nothing past the end of the blocks it was given", () => {
    const lead = script.slice(0, 4);
    expect(continuesSpeech(lead, 4, "MARA")).toBe(true);
    expect(continuesSpeech(lead, 6, "MARA")).toBe(false);
  });

  it("needs a name", () => {
    expect(continuesSpeech(script, 4, "")).toBe(false);
    expect(continuesSpeech(script, 4, "(V.O.)")).toBe(false);
  });
});

describe("the index", () => {
  const sequences = [
    [
      b("scene-heading", "INT. LAB - NIGHT"),
      b("character", "MARA"),
      b("dialogue", "Hello."),
      b("character", "JONAH (V.O.)"),
      b("scene-heading", "int. lab - day"),
      b("character", "mara (CONT'D)"),
    ],
    [b("scene-heading", "EXT. ROOFTOP - NIGHT"), b("character", "MARA"), b("character", "OLD MAN")],
  ];

  it("ranks names by how often they are used, then how recently", () => {
    const index = buildScriptIndex(sequences);
    expect(index.names).toEqual(["MARA", "OLD MAN", "JONAH"]);
  });

  it("learns places and times of day, without the prefix", () => {
    const index = buildScriptIndex(sequences);
    expect(index.places).toEqual(["LAB", "ROOFTOP"]);
    expect(index.times).toEqual(["NIGHT", "DAY"]);
  });

  it("adds the story bible's names after the used ones, once each", () => {
    const index = buildScriptIndex(sequences, { names: ["Mara", "Priya", "priya", ""], places: ["Greenhouse"] });
    expect(index.names).toEqual(["MARA", "OLD MAN", "JONAH", "PRIYA"]);
    expect(index.places).toEqual(["LAB", "ROOFTOP", "GREENHOUSE"]);
  });

  it("indexes nothing from an empty script", () => {
    expect(buildScriptIndex([])).toEqual({ names: [], places: [], times: [] });
  });

  it("does not take a heading with no prefix for a place", () => {
    expect(buildScriptIndex([[b("scene-heading", "SOMEWHERE")]]).places).toEqual([]);
  });
});

describe("what a line offers", () => {
  const index = buildScriptIndex(
    [
      [
        b("scene-heading", "INT. LAB - NIGHT"),
        b("scene-heading", "INT. LAB BASEMENT - DAY"),
        b("character", "MARA"),
        b("character", "MARCUS"),
        b("scene-heading", "INT. LAB - NIGHT"),
        b("character", "MARA"),
      ],
    ],
    { names: ["Priya"] }
  );
  const labels = (list: ReturnType<typeof completionsFor>) => list.map((c) => c.label);

  it("offers names that continue what is typed, bible names included", () => {
    expect(labels(completionsFor("character", "MA", index))).toEqual(["MARA", "MARCUS"]);
    expect(labels(completionsFor("character", "pr", index))).toEqual(["PRIYA"]);
    expect(labels(completionsFor("character", "ZZ", index))).toEqual([]);
  });

  it("waits for a first letter on the desk, and shows everything on the phone", () => {
    expect(completionsFor("character", "", index)).toEqual([]);
    expect(labels(completionsFor("character", "", index, { whenEmpty: true }))).toEqual(["MARA", "MARCUS", "PRIYA"]);
    expect(labels(completionsFor("scene-heading", "", index, { whenEmpty: true }))).toEqual(["INT.", "EXT.", "INT./EXT."]);
  });

  it("puts a name already typed in full first, so Tab can move on", () => {
    const list = completionsFor("character", "MARA", index);
    expect(list[0].insert).toBe("MARA");
    expect(applyCompletion("MARA", list[0])).toBe("MARA");
  });

  it("offers CONT'D for a cue that continues a speech", () => {
    const list = completionsFor("character", "MA", index, { continues: (name) => name === "MARA" });
    expect(labels(list)).toEqual(["MARA (CONT'D)", "MARA", "MARCUS"]);
    expect(applyCompletion("MA", list[0])).toBe("MARA (CONT'D)");
  });

  it("offers nothing once an extension is being written", () => {
    expect(completionsFor("character", "MARA (", index)).toEqual([]);
  });

  it("offers INT. and EXT. while a heading starts", () => {
    expect(labels(completionsFor("scene-heading", "i", index))).toEqual(["INT.", "INT./EXT."]);
    expect(labels(completionsFor("scene-heading", "EX", index))).toEqual(["EXT."]);
    expect(applyCompletion("EX", completionsFor("scene-heading", "EX", index)[0])).toBe("EXT. ");
  });

  it("still offers the dotted prefix when the dot was left off", () => {
    expect(labels(completionsFor("scene-heading", "INT", index))).toEqual(["INT.", "INT./EXT."]);
    expect(applyCompletion("INT", completionsFor("scene-heading", "INT", index)[0])).toBe("INT. ");
    expect(labels(completionsFor("scene-heading", "ext", index))).toEqual(["EXT."]);
    expect(labels(completionsFor("scene-heading", "INT/EXT", index))).toEqual(["INT./EXT."]);
  });

  it("gives the prefix its dot when a place or time is chosen after it", () => {
    const places = completionsFor("scene-heading", "INT ", index);
    expect(labels(places)).toEqual(["LAB", "LAB BASEMENT"]);
    expect(applyCompletion("INT ", places[0])).toBe("INT. LAB - ");
    expect(applyCompletion("INT LA", completionsFor("scene-heading", "INT LA", index)[0])).toBe("INT. LAB - ");
    expect(applyCompletion("EXT LAB - ", completionsFor("scene-heading", "EXT LAB - ", index)[0])).toBe("EXT. LAB - NIGHT");
  });

  it("leaves a bare INT. for Tab, then offers the places", () => {
    expect(completionsFor("scene-heading", "INT.", index)).toEqual([]);
    const list = completionsFor("scene-heading", "INT. ", index);
    expect(labels(list)).toEqual(["LAB", "LAB BASEMENT"]);
    expect(applyCompletion("INT. ", list[0])).toBe("INT. LAB - ");
  });

  it("filters places by what is typed, from any word", () => {
    expect(labels(completionsFor("scene-heading", "INT. LA", index))).toEqual(["LAB", "LAB BASEMENT"]);
    expect(labels(completionsFor("scene-heading", "INT. base", index))).toEqual(["LAB BASEMENT"]);
    expect(applyCompletion("INT. LA", completionsFor("scene-heading", "INT. LA", index)[0])).toBe("INT. LAB - ");
  });

  it("puts a place typed in full first", () => {
    const list = completionsFor("scene-heading", "INT. LAB", index);
    expect(list[0].insert).toBe("LAB - ");
    expect(applyCompletion("INT. LAB", list[0])).toBe("INT. LAB - ");
  });

  it("offers the script's times of day, then the usual ones", () => {
    const list = completionsFor("scene-heading", "INT. LAB - ", index);
    expect(labels(list).slice(0, 2)).toEqual(["NIGHT", "DAY"]);
    expect(labels(list)).toContain("MORNING");
    expect(applyCompletion("INT. LAB - ", list[0])).toBe("INT. LAB - NIGHT");
    expect(applyCompletion("INT. LAB -", completionsFor("scene-heading", "INT. LAB -", index)[0])).toBe("INT. LAB - NIGHT");
  });

  it("filters times by what is typed and stops once the time is whole", () => {
    expect(labels(completionsFor("scene-heading", "INT. LAB - M", index))).toEqual(["MORNING", "MOMENTS LATER"]);
    expect(completionsFor("scene-heading", "INT. LAB - NIGHT", index)).toEqual([]);
    expect(applyCompletion("INT. LAB - NI", completionsFor("scene-heading", "INT. LAB - NI", index)[0])).toBe("INT. LAB - NIGHT");
  });

  it("offers Spanish times for a Spanish app", () => {
    const list = completionsFor("scene-heading", "INT. LAB - NO", buildScriptIndex([]), { language: "es" });
    expect(labels(list)).toEqual(["NOCHE"]);
  });

  it("limits how many it offers", () => {
    expect(completionsFor("scene-heading", "INT. LAB - ", index, { limit: 3 })).toHaveLength(3);
  });

  it("offers nothing on the other elements", () => {
    expect(completionsFor("action", "MA", index)).toEqual([]);
    expect(completionsFor("dialogue", "MA", index)).toEqual([]);
  });
});

describe("scenes", () => {
  const blocks = [
    b("action", "Black."),
    b("scene-heading", "int. lab - night"),
    b("action", "A hum."),
    b("character", "MARA"),
    b("dialogue", "Hello."),
    b("scene-heading", "EXT. ROOF - DAY"),
    b("action", "Wind."),
    b("scene-heading", "INT. HALL - DAY"),
    b("action", "Quiet."),
  ];

  it("outlines each scene with its title and page", () => {
    const outline = sceneOutline(blocks);
    expect(outline.map((s) => s.title)).toEqual(["", "INT. LAB - NIGHT", "EXT. ROOF - DAY", "INT. HALL - DAY"]);
    expect(outline.map((s) => s.page)).toEqual([1, 1, 1, 1]);
    expect(outline[1]).toMatchObject({ heading: 1, start: 1, end: 5 });
  });

  it("counts pages from where the sequence begins", () => {
    expect(sceneOutline(blocks, { page: 7, line: 0 })[1].page).toBe(7);
  });

  it("puts a scene on the page its heading falls on", () => {
    const long = [
      b("scene-heading", "INT. A - DAY"),
      ...Array.from({ length: 40 }, () => b("action", "Line.")),
      b("scene-heading", "INT. B - DAY"),
      b("action", "More."),
    ];
    const outline = sceneOutline(long);
    expect(outline[0].page).toBe(1);
    expect(outline[1].page).toBeGreaterThan(1);
  });

  it("moves a scene to where another is", () => {
    // Scene 1 (lab) after scene 2 (roof): blocks 5,6 come first.
    expect(moveSceneOrder(blocks, 1, 2)).toEqual([0, 5, 6, 1, 2, 3, 4, 7, 8]);
    expect(moveSceneOrder(blocks, 3, 1)).toEqual([0, 7, 8, 1, 2, 3, 4, 5, 6]);
  });

  it("leaves the lead-in in place and refuses a move to nowhere", () => {
    expect(moveSceneOrder(blocks, 0, 2)).toBeNull();
    expect(moveSceneOrder(blocks, 2, 0)).toBeNull();
    expect(moveSceneOrder(blocks, 2, 2)).toBeNull();
    expect(moveSceneOrder(blocks, 2, 9)).toBeNull();
  });

  it("is a permutation", () => {
    const order = moveSceneOrder(blocks, 1, 3)!;
    expect([...order].sort((x, y) => x - y)).toEqual(blocks.map((_, i) => i));
  });
});

describe("story bible names", () => {
  it("takes a character's name from the first line of the file, else from the slug", () => {
    expect(
      bibleCharacterNames([
        { path: "canon.md", summary: "Canon" },
        { path: "characters/mara.md", summary: "Mara Vance" },
        { path: "characters/old-man.md", summary: "(empty)" },
        { path: "characters/priya.md", summary: "A very long first line that is clearly a sentence, not a name" },
        { path: "plot/heist.md", summary: "The heist" },
      ])
    ).toEqual(["Mara Vance", "old man", "priya"]);
  });
});

describe("choices that end without a space (the phone)", () => {
  const index = buildScriptIndex([[b("scene-heading", "INT. LAB - NIGHT")]]);
  const apply = (text: string, i = 0) => {
    const list = completionsFor("scene-heading", text, index, { trailing: false, whenEmpty: true });
    return applyCompletion(text, list[i]);
  };

  it("walks a heading in three taps, never ending a line in a space", () => {
    expect(apply("", 0)).toBe("INT.");
    expect(apply("INT.")).toBe("INT. LAB -");
    expect(apply("INT. L")).toBe("INT. LAB -");
    expect(apply("INT. LAB -")).toBe("INT. LAB - NIGHT");
  });

  it("offers the dotted prefix, then places that keep the dot, when the dot was left off", () => {
    expect(apply("INT")).toBe("INT.");
    expect(apply("INT L")).toBe("INT. LAB -");
  });

  it("makes Tab a quiet no-op on a bare INT. and adds the dash after a location", () => {
    expect(smartTab("scene-heading", "INT.", { trailing: false })).toEqual({ kind: "insert", text: "" });
    expect(smartTab("scene-heading", "INT. LAB", { trailing: false })).toEqual({ kind: "insert", text: " -" });
  });
});
