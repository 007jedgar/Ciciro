import { describe, expect, it } from "vitest";
import {
  BRIEF_WINS,
  EM_DASH_STYLE_LINE,
  FICTION_HABITS,
  NONFICTION_HABITS,
  craftHabitsFor,
  emDashesAllowed,
} from "@/lib/craft-defaults";
import { drafterDirective, kindDirective, MANUSCRIPT_KINDS } from "@/lib/manuscript-kind";
import {
  DRAFTER_SYSTEM,
  EDITOR_SYSTEM,
  drafterSystemFor,
  editBeatInstruction,
  editorSystemFor,
  proseCheckSystemFor,
} from "@/lib/prompts";

// The drafter prompt and the auto-draft edit instruction exactly as they were
// before craft defaults. With the "Experimental writing prompt" setting off (the
// default), and for the side-by-side demo's baseline arm, `craft: false` must
// reproduce them byte for byte.
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
  it("reproduces the pre-craft prompt for every kind when craft defaults are off", () => {
    expect(DRAFTER_SYSTEM).toBe(DRAFTER_BEFORE);
    for (const kind of MANUSCRIPT_KINDS) {
      const directive = drafterDirective(kind);
      const before = directive ? `${DRAFTER_BEFORE}\n\n${directive}` : DRAFTER_BEFORE;
      expect(drafterSystemFor(kind)).toBe(before);
      expect(drafterSystemFor(kind, { craft: false })).toBe(before);
      expect(drafterSystemFor(kind, { craft: false, emDashes: false })).toBe(before);
    }
  });

  it("keeps the em-dash switch working with craft defaults off", () => {
    const allowed = drafterSystemFor("novel", { emDashes: true });
    expect(allowed).not.toContain("Never use em dashes");
    expect(allowed).toContain("Em dashes are allowed");
    expect(allowed).not.toContain("Craft defaults");
  });

  it("gives fiction the fiction habits, the voice override, and the brief override", () => {
    for (const kind of ["novel", "screenplay"] as const) {
      const prompt = drafterSystemFor(kind, { craft: true });
      for (const habit of FICTION_HABITS) expect(prompt).toContain(habit.rule);
      expect(prompt).toContain("The author's voice wins");
      expect(prompt).toContain(BRIEF_WINS);
      expect(prompt).not.toContain(NONFICTION_HABITS[0].rule);
    }
    expect(drafterSystemFor("screenplay", { craft: true })).toContain("script pages");
  });

  it("gives a blog the nonfiction habits and a journal none", () => {
    const blog = drafterSystemFor("blog", { craft: true });
    for (const habit of NONFICTION_HABITS) expect(blog).toContain(habit.rule);
    expect(blog).not.toContain(FICTION_HABITS[0].rule);

    const journal = drafterSystemFor("journal", { craft: true });
    expect(journal).toContain("private journal entry");
    expect(journal).not.toContain("Craft defaults");
    expect(craftHabitsFor("journal")).toEqual([]);
  });

  it("swaps the dash rule when the author allows em dashes", () => {
    const banned = drafterSystemFor("novel", { craft: true });
    const allowed = drafterSystemFor("novel", { craft: true, emDashes: true });
    expect(banned).toContain("Never use em dashes");
    expect(allowed).not.toContain("Never use em dashes");
    expect(allowed).toContain("Em dashes are allowed");
  });
});

describe("editor craft defaults", () => {
  it("adds nothing to the editor prompt when craft defaults are off", () => {
    for (const kind of MANUSCRIPT_KINDS) {
      const before = [EDITOR_SYSTEM, kindDirective(kind), "EXTRA"].filter(Boolean).join("\n\n");
      expect(editorSystemFor(kind, "EXTRA")[0].text).toBe(before);
      expect(editorSystemFor(kind, "EXTRA", { craft: false })[0].text).toBe(before);
      expect(editorSystemFor(kind)[0].text).not.toContain("CRAFT CHECK");
    }
  });

  it("appends the craft section after the kind directive and before any extra", () => {
    const text = editorSystemFor("screenplay", "EXTRA", { craft: true })[0].text;
    expect(text).toMatch(/SCREENPLAY[\s\S]*# Craft defaults for drafted prose[\s\S]*EXTRA$/);
    for (const habit of FICTION_HABITS) expect(text).toContain(habit.name);
    expect(text).toContain("CRAFT CHECK");
    expect(text).toContain("Anything the author or a brief explicitly asks for outranks these defaults");
  });

  it("keeps the CRAFT CHECK handling but no habit list for a journal", () => {
    const text = editorSystemFor("journal", "", { craft: true })[0].text;
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

  it("puts the brief, then a craft check, just before the return instruction", () => {
    const text = editBeatInstruction("g", "d", "", { brief: "Swap the coffee.", check: "CRAFT CHECK (x):\n- [em dash] \"a\" - b" });
    expect(text).toContain(
      `</draft>\n\nThe beat was drafted from this brief. ${BRIEF_WINS}\n<brief>\nSwap the coffee.\n</brief>\n\nCRAFT CHECK (x):\n- [em dash] "a" - b\n\nReturn ONLY`
    );
    const noFindings = editBeatInstruction("g", "d", "", { brief: "Swap the coffee.", check: "" });
    expect(noFindings).toContain("</brief>\n\nReturn ONLY");
  });
});

describe("prose check prompt", () => {
  it("lists each habit by name for fiction and blog, and is empty for a journal", () => {
    const fiction = proseCheckSystemFor("novel");
    for (const habit of FICTION_HABITS) expect(fiction).toContain(`- ${habit.name}: `);
    expect(fiction).toContain("Dialogue is exempt");
    expect(fiction).toContain("neither is anything the brief explicitly asks for");
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
