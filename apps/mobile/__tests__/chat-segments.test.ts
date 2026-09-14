import { closeOpenDrafts, draftParagraphs, parseChatSegments } from "../lib/chat-segments";

describe("parseChatSegments", () => {
  it("splits markdown from closed and open draft blocks", () => {
    expect(
      parseChatSegments("Note.\n<draft>First paragraph.\n\nSecond.</draft>Tail")
    ).toEqual([
      { kind: "md", text: "Note.\n" },
      { kind: "draft", text: "First paragraph.\n\nSecond.", open: false },
      { kind: "md", text: "Tail" },
    ]);
    expect(parseChatSegments("Working <draft>half")).toEqual([
      { kind: "md", text: "Working " },
      { kind: "draft", text: "half", open: true },
    ]);
  });
});

describe("closeOpenDrafts", () => {
  it("closes a live draft so insert buttons can appear after the stream ends", () => {
    expect(closeOpenDrafts("Hi <draft>Night.")).toBe("Hi <draft>Night.</draft>");
    expect(closeOpenDrafts("Hi <draft>Night.</draft>")).toBe("Hi <draft>Night.</draft>");
  });
});

describe("draftParagraphs", () => {
  it("splits on blank lines and drops empty parts", () => {
    expect(draftParagraphs("One.\n\n\nTwo.\n\n  ")).toEqual(["One.", "Two."]);
  });
});
