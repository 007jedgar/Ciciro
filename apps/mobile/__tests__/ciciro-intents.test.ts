import { asCiciroIntent, chatRequestFromComposer, chatRequestFromIntent } from "../lib/ciciro-intents";

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
