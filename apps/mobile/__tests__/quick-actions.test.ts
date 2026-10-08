import en from "../lib/i18n/locales/en";
import { MANUSCRIPT_KINDS } from "../lib/manuscript-kind";
import { chatRequestFromAction, quickActionsFor } from "../lib/quick-actions";

describe("quickActionsFor", () => {
  it("offers a labelled chip set for every kind of manuscript", () => {
    for (const kind of MANUSCRIPT_KINDS) {
      const actions = quickActionsFor(kind);
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(en.quickActions[action.id as keyof typeof en.quickActions]).toBeTruthy();
      }
    }
  });
});

describe("chatRequestFromAction", () => {
  const critique = quickActionsFor("novel").find((a) => a.id === "critique-chapter")!;
  const tighten = quickActionsFor("novel").find((a) => a.id === "tighten-dialogue")!;

  it("sends the brief for the open chapter without a selection", () => {
    const input = chatRequestFromAction(critique, { projectId: "p1", chapterId: "c1", selection: "ignored" });
    expect(input).toMatchObject({
      projectId: "p1",
      message: critique.prompt,
      kind: "action",
      scope: "chapter",
      activeChapterId: "c1",
    });
    expect(input.selection).toBeUndefined();
  });

  it("carries the highlighted text to an action scoped to it", () => {
    const input = chatRequestFromAction(tighten, { projectId: "p1", chapterId: "c1", selection: "  \"Go,\" she said.  " });
    expect(input.scope).toBe("selection");
    expect(input.selection).toBe('"Go," she said.');
  });
});
