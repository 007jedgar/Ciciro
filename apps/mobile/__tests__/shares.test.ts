import i18n from "../lib/i18n";
import type { ShareComment } from "../lib/api/types";
import {
  betaReadersHref,
  commentCountsByChapter,
  groupCommentsByChapter,
  shareLinkUrl,
  shareLinksHref,
} from "../lib/shares";

function comment(id: string, chapterId: string, chapterTitle = ""): ShareComment {
  return {
    id,
    shareLinkId: "l1",
    linkLabel: "",
    chapterId,
    chapterTitle,
    readerName: "Sam",
    body: "Nice",
    quote: "cold",
    status: "open",
    createdAt: "2026-09-26T10:00:00.000Z",
    resolvedAt: null,
    anchor: { blockId: "b", offset: 0, length: 4 },
  };
}

describe("beta reader helpers", () => {
  it("builds the reader link on the Ciciro server", () => {
    expect(shareLinkUrl({ path: "/read/abc" }, "https://ciciro.example/")).toBe("https://ciciro.example/read/abc");
    expect(shareLinkUrl({ path: "/read/abc" }, "http://localhost:3000")).toBe("http://localhost:3000/read/abc");
  });

  it("routes to the comments and links screens", () => {
    expect(betaReadersHref("p1")).toBe("/project/p1/beta-readers");
    expect(betaReadersHref("p1", "c 1")).toBe("/project/p1/beta-readers?chapterId=c%201");
    expect(shareLinksHref("p1")).toBe("/project/p1/share-links");
  });

  it("groups comments in manuscript order, archived chapters last", () => {
    const chapters = [
      { id: "c1", title: "One" },
      { id: "c2", title: "Two" },
    ];
    const groups = groupCommentsByChapter(
      [comment("a", "c2"), comment("b", "gone", "Old"), comment("c", "c1"), comment("d", "c2")],
      chapters
    );
    expect(groups.map((g) => [g.chapterId, g.number, g.title, g.comments.map((c) => c.id)])).toEqual([
      ["c1", 1, "One", ["c"]],
      ["c2", 2, "Two", ["a", "d"]],
      ["gone", 0, "Old", ["b"]],
    ]);
  });

  it("counts comments per chapter", () => {
    const counts = commentCountsByChapter([comment("a", "c1"), comment("b", "c1"), comment("c", "c2")]);
    expect(counts.get("c1")).toBe(2);
    expect(counts.get("c2")).toBe(1);
  });

  it("says nothing about comments when a deleted link had none", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("beta.links.deleteMessage", { count: 0 })).toBe("This can't be undone.");
    expect(i18n.t("beta.links.deleteMessage", { count: 1 })).toBe(
      "Its 1 comment is deleted too. This can't be undone."
    );
    expect(i18n.t("beta.chapterComments", { count: 2 })).toBe("2 reader comments");
  });
});
