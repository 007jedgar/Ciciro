import {
  asCiciroIntent,
  asSelectionAction,
  chatRequestFromComposer,
  chatRequestFromIntent,
  chatRequestFromSelectionAction,
} from "../lib/ciciro-intents";

describe("asCiciroIntent", () => {
  it("accepts the three writing-tool intents and ignores anything else", () => {
    expect(asCiciroIntent("continue")).toBe("continue");
    expect(asCiciroIntent(["rewrite"])).toBe("rewrite");
    expect(asCiciroIntent("chat")).toBeNull();
    expect(asCiciroIntent(undefined)).toBeNull();
  });
});

describe("chatRequestFromIntent", () => {
  it("sends a continue brief scoped to the open chapter", () => {
    const input = chatRequestFromIntent("continue", { projectId: "p1", chapterId: "c1" });
    expect(input).toMatchObject({
      projectId: "p1",
      kind: "continue",
      scope: "chapter",
      activeChapterId: "c1",
    });
    expect(input.message).toContain("<draft>");
  });

  it("falls back to chapter scope when rewrite has no selection", () => {
    const input = chatRequestFromIntent("rewrite", { projectId: "p1", chapterId: "c1" });
    expect(input.scope).toBe("chapter");
    expect(input.selection).toBeUndefined();

    const selected = chatRequestFromIntent("rewrite", {
      projectId: "p1",
      chapterId: "c1",
      selection: "  the lantern  ",
    });
    expect(selected.scope).toBe("selection");
    expect(selected.selection).toBe("the lantern");
  });

  it("leaves a lingering highlight out of chapter-scoped intents", () => {
    for (const intent of ["continue", "describe"] as const) {
      const input = chatRequestFromIntent(intent, {
        projectId: "p1",
        chapterId: "c1",
        selection: "the lantern",
      });
      expect(input.scope).toBe("chapter");
      expect(input).not.toHaveProperty("selection");
    }
  });
});

describe("chatRequestFromComposer", () => {
  it("returns a chapter-scoped chat turn, or null when the box is blank", () => {
    expect(chatRequestFromComposer("  ", { projectId: "p1", chapterId: "c1" })).toBeNull();
    expect(chatRequestFromComposer(" Tighten the opening. ", { projectId: "p1", chapterId: "c1" })).toEqual({
      projectId: "p1",
      message: "Tighten the opening.",
      kind: "chat",
      scope: "chapter",
      activeChapterId: "c1",
    });
  });
});

describe("asSelectionAction", () => {
  it("accepts the menu's five actions and ignores anything else", () => {
    expect(asSelectionAction("comment")).toBe("comment");
    expect(asSelectionAction(["fix"])).toBe("fix");
    expect(asSelectionAction("continue")).toBeNull();
    expect(asSelectionAction(undefined)).toBeNull();
  });
});

describe("chatRequestFromSelectionAction", () => {
  const ctx = { projectId: "p1", chapterId: "c1", selection: "  the country  ", kind: "novel" as const };

  it("sends the action's brief as a selection-scoped quick action carrying the text", () => {
    const input = chatRequestFromSelectionAction("rewrite", ctx);
    expect(input).toMatchObject({
      projectId: "p1",
      kind: "action",
      scope: "selection",
      activeChapterId: "c1",
      selection: "the country",
    });
    expect(input?.message).toContain("<draft>");
  });

  it("sends nothing without a selection", () => {
    expect(chatRequestFromSelectionAction("fix", { ...ctx, selection: "   " })).toBeNull();
  });
});

describe("chatRequestFromComposer with a comment's selection", () => {
  it("attaches the highlighted text and scopes the turn to it", () => {
    const input = chatRequestFromComposer("Is this too blunt?", {
      projectId: "p1",
      chapterId: "c1",
      selection: "the country",
    });
    expect(input).toMatchObject({ kind: "chat", scope: "selection", selection: "the country" });
  });

  it("stays a chapter-scoped chat without one", () => {
    const input = chatRequestFromComposer("Hello", { projectId: "p1", chapterId: "c1" });
    expect(input).toMatchObject({ scope: "chapter" });
    expect(input?.selection).toBeUndefined();
  });
});
