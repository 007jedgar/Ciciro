import { describe, expect, it } from "vitest";
import {
  EM_DASH_STYLE_LINE,
  FICTION_HABITS,
  NONFICTION_HABITS,
  craftHabitsFor,
  emDashesAllowed,
} from "@/lib/craft-defaults";
import {
  DRAFTER_SYSTEM,
  drafterSystemFor,
  editBeatInstruction,
  editorSystemFor,
  proseCheckSystemFor,
} from "@/lib/prompts";

// The drafter prompt and the auto-draft edit instruction exactly as they were
// before craft defaults. The side-by-side demo's baseline arm relies on
// `craft: false` reproducing them byte for byte.
const DRAFTER_BEFORE = `You are a novelist's drafting hand. You receive a precise brief from the editor and
return prose that fulfills it exactly. You cannot see the wider manuscript or story
bible; the brief contains everything you need.

Rules:
- Follow the brief literally. Honor the POV, tense, voice notes, canon constraints,
  length, and the "do NOT" list precisely. Do not generalize beyond what it says.
- Match the established voice in the continuity excerpt. Do not drift into your own
  style.
- Write ONLY the prose. No preamble, no notes, no headings, no summary of what you
  did. Do not restate the brief.
- Hit the target length. Move the scene forward; do not summarize or skip ahead.
- Never use em dashes; use a hyphen "-".`;

function editBefore(goal: string, draft: string, tail: string): string {
  return `You are editing one drafted beat of the chapter to final. Enforce the story's voice,
POV, tense, and canon; tighten prose; fix any drift or continuity break with the text
before it. Beat goal: ${goal}.
${tail ? `It follows this text:\n<before>\n${tail}\n</before>\n` : ""}
Here is the draft to edit:\n<draft>\n${draft}\n</draft>\n
Return ONLY the final edited prose for this beat - no commentary, no headings, no draft tags.`;
}

describe("drafter craft defaults", () => {
  it("reproduces the pre-craft prompt when craft defaults are off", () => {
    expect(DRAFTER_SYSTEM).toBe(DRAFTER_BEFORE);
    expect(drafterSystemFor("novel", { craft: false })).toBe(DRAFTER_BEFORE);
  });

  it("gives fiction the fiction habits and the voice override", () => {
    for (const kind of ["novel", "screenplay"] as const) {
      const prompt = drafterSystemFor(kind);
      for (const habit of FICTION_HABITS) expect(prompt).toContain(habit.rule);
      expect(prompt).toContain("The author's voice wins");
      expect(prompt).not.toContain(NONFICTION_HABITS[0].rule);
    }
    expect(drafterSystemFor("screenplay")).toContain("script pages");
  });

  it("gives a blog the nonfiction habits and a journal none", () => {
    const blog = drafterSystemFor("blog");
    for (const habit of NONFICTION_HABITS) expect(blog).toContain(habit.rule);
    expect(blog).not.toContain(FICTION_HABITS[0].rule);

    const journal = drafterSystemFor("journal");
    expect(journal).toContain("private journal entry");
    expect(journal).not.toContain("Craft defaults");
    expect(craftHabitsFor("journal")).toEqual([]);
  });

  it("swaps the dash rule when the author allows em dashes", () => {
    const banned = drafterSystemFor("novel");
    const allowed = drafterSystemFor("novel", { emDashes: true });
    expect(banned).toContain("Never use em dashes");
    expect(allowed).not.toContain("Never use em dashes");
    expect(allowed).toContain("Em dashes are allowed");
  });
});

describe("editor craft defaults", () => {
  it("appends the craft section after the kind directive and before any extra", () => {
    const text = editorSystemFor("screenplay", "EXTRA")[0].text;
    expect(text).toMatch(/SCREENPLAY[\s\S]*# Craft defaults for drafted prose[\s\S]*EXTRA$/);
    for (const habit of FICTION_HABITS) expect(text).toContain(habit.name);
    expect(text).toContain("CRAFT CHECK");
  });

  it("keeps the CRAFT CHECK handling but no habit list for a journal", () => {
    const text = editorSystemFor("journal")[0].text;
    expect(text).toContain("CRAFT CHECK");
    expect(text).not.toContain(FICTION_HABITS[0].name);
  });

  it("tells the editor how the author switches em dashes on", () => {
    expect(editorSystemFor("novel")[0].text).toContain('"Em dashes: allowed"');
  });

  it("builds the beat edit instruction unchanged without a craft check", () => {
    expect(editBeatInstruction("Mara finds the key", "Draft text.", "")).toBe(
      editBefore("Mara finds the key", "Draft text.", "")
    );
    expect(editBeatInstruction("g", "d", "the tail")).toBe(editBefore("g", "d", "the tail"));
  });

  it("puts a craft check just before the return instruction", () => {
    const text = editBeatInstruction("g", "d", "", "CRAFT CHECK (x):\n- [em dash] \"a\" - b");
    expect(text).toMatch(/<\/draft>\n\nCRAFT CHECK \(x\):\n- \[em dash\] "a" - b\n\nReturn ONLY/);
  });
});

describe("prose check prompt", () => {
  it("lists each habit by name for fiction and blog, and is empty for a journal", () => {
    const fiction = proseCheckSystemFor("novel");
    for (const habit of FICTION_HABITS) expect(fiction).toContain(`- ${habit.name}: `);
    expect(fiction).toContain("Dialogue is exempt");
    expect(proseCheckSystemFor("blog")).toContain(`- ${NONFICTION_HABITS[0].name}: `);
    expect(proseCheckSystemFor("journal")).toBe("");
  });
});

describe("em-dash switch in style.md", () => {
  it("is off by default, for the seeded line, and for the old ban", () => {
    expect(emDashesAllowed("")).toBe(false);
    expect(emDashesAllowed(null)).toBe(false);
    expect(emDashesAllowed(`# Style\n${EM_DASH_STYLE_LINE}\n`)).toBe(false);
    expect(emDashesAllowed('# Style\n- Never use em dashes; use a hyphen "-".\n')).toBe(false);
    expect(emDashesAllowed("- Em dashes: not allowed")).toBe(false);
    expect(emDashesAllowed("Prose note: em dashes: allowed only in dialogue")).toBe(false);
  });

  it("turns on with an 'Em dashes: allowed' line in any common spelling", () => {
    expect(emDashesAllowed("# Style\n- Em dashes: allowed\n")).toBe(true);
    expect(emDashesAllowed("em-dashes: Allowed")).toBe(true);
    expect(emDashesAllowed("* **Em dashes:** allowed, like my drafts")).toBe(true);
    expect(emDashesAllowed("- **Em dash**: allowed")).toBe(true);
    expect(emDashesAllowed(EM_DASH_STYLE_LINE.replace("not allowed", "allowed"))).toBe(true);
  });
});
