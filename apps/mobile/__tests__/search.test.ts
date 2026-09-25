import { ciciro } from "../lib/api";
import { groupMatches, matchKey, replaceInManuscript, SearchUnsyncedError } from "../lib/search";
import type { SearchMatch } from "../lib/api/types";

const match = (chapterId: string, blockId: string, occurrence = 0): SearchMatch => ({
  chapterId,
  chapterTitle: chapterId.toUpperCase(),
  chapterNumber: chapterId === "c1" ? 1 : 2,
  blockId,
  occurrence,
  offset: 0,
  length: 3,
  before: "",
  match: "Jon",
  after: " met",
});

describe("manuscript search", () => {
  afterEach(() => jest.restoreAllMocks());

  it("groups consecutive matches by chapter", () => {
    const groups = groupMatches([match("c1", "a"), match("c1", "b"), match("c2", "a")]);
    expect(groups.map((g) => [g.chapterId, g.matches.length, g.number])).toEqual([
      ["c1", 2, 1],
      ["c2", 1, 2],
    ]);
    expect(matchKey(match("c1", "a", 2))).toBe("c1:a:2");
  });

  it("flushes queued edits before replacing", async () => {
    const order: string[] = [];
    const replace = jest.spyOn(ciciro.search, "replace").mockImplementation(async () => {
      order.push("replace");
      return { replaced: 2, chapters: [] };
    });
    const count = await replaceInManuscript(
      "p1",
      "Jon",
      "Ann",
      { matchCase: true, wholeWord: false },
      {
        flush: async () => {
          order.push("flush");
          return true;
        },
      }
    );
    expect(count).toBe(2);
    expect(order).toEqual(["flush", "replace"]);
    expect(replace.mock.calls[0][1]).toEqual({
      query: "Jon",
      replacement: "Ann",
      matchCase: true,
      wholeWord: false,
    });
  });

  it("addresses one match when replacing it", async () => {
    const replace = jest
      .spyOn(ciciro.search, "replace")
      .mockResolvedValue({ replaced: 1, chapters: [] });
    await replaceInManuscript(
      "p1",
      "Jon",
      "Ann",
      { matchCase: false, wholeWord: true },
      { target: match("c2", "b", 1) }
    );
    expect(replace.mock.calls[0][1].target).toEqual({ chapterId: "c2", blockId: "b", occurrence: 1, offset: 0 });
  });

  it("refuses to replace while edits are unsynced", async () => {
    const replace = jest.spyOn(ciciro.search, "replace");
    await expect(
      replaceInManuscript("p1", "a", "b", { matchCase: false, wholeWord: false }, { flush: async () => false })
    ).rejects.toBeInstanceOf(SearchUnsyncedError);
    expect(replace).not.toHaveBeenCalled();
  });
});
