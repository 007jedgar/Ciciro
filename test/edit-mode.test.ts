import { describe, expect, it } from "vitest";
import { QUICK_ACTIONS } from "@/lib/prompts";
import { editorToolsFor, EDITOR_TOOLS } from "@/lib/tools";
import {
  DEFAULT_EDIT_MODE,
  MANUSCRIPT_WRITE_TOOLS,
  editModeFor,
  editModeOfRuns,
  editsAllowedFor,
  isManuscriptWriteTool,
} from "@/lib/edit-mode";

describe("edit mode", () => {
  it("starts a conversation on Allow edits", () => {
    expect(DEFAULT_EDIT_MODE).toBe("edits");
    expect(editModeOfRuns([])).toBe("edits");
  });

  it("is the mode the conversation's latest turn ran under", () => {
    expect(editModeOfRuns([{ editsAllowed: true }, { editsAllowed: false }])).toBe("chat");
    expect(editModeOfRuns([{ editsAllowed: false }, { editsAllowed: true }])).toBe("edits");
    // Runs from before the switch existed carry no value and allowed edits.
    expect(editModeOfRuns([{}])).toBe("edits");
    expect(editModeOfRuns([{ editsAllowed: null }])).toBe("edits");
  });

  it("round-trips the mode and the server flag", () => {
    expect(editsAllowedFor("edits")).toBe(true);
    expect(editsAllowedFor("chat")).toBe(false);
    expect(editModeFor(false)).toBe("chat");
    expect(editModeFor(true)).toBe("edits");
    expect(editModeFor(undefined)).toBe("edits");
  });

  it("names only real tools as manuscript-writing, and withholds exactly those on Chat only", () => {
    const names = EDITOR_TOOLS.map((tool) => tool.name);
    for (const name of MANUSCRIPT_WRITE_TOOLS) expect(names).toContain(name);
    expect(editorToolsFor(true)).toBe(EDITOR_TOOLS);
    const chatOnly = editorToolsFor(false).map((tool) => tool.name);
    expect(chatOnly).toEqual(names.filter((name) => !isManuscriptWriteTool(name)));
    expect(chatOnly).toContain("read_chapter");
  });

  it("flags the shortcut that moves text, so Chat only explains instead of sending it", () => {
    expect(QUICK_ACTIONS.filter((a) => a.writes).map((a) => a.id)).toEqual(["fix-misplaced"]);
  });
});
