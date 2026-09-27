import { applyChapterOrder, dragShift, dropIndexFor, moveItem, OUTLINE_ROW_HEIGHT, outlineHref } from "../lib/outline";

describe("outline helpers", () => {
  it("moves an item and clamps the target", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("turns a drag distance into a whole-row drop index", () => {
    const h = OUTLINE_ROW_HEIGHT;
    expect(dropIndexFor(1, 0, 4)).toBe(1);
    expect(dropIndexFor(1, h * 0.4, 4)).toBe(1);
    expect(dropIndexFor(1, h * 0.6, 4)).toBe(2);
    expect(dropIndexFor(1, -h * 5, 4)).toBe(0);
    expect(dropIndexFor(1, h * 9, 4)).toBe(3);
    expect(dropIndexFor(0, 50, 0)).toBe(0);
  });

  it("applies an id order, renumbers, and keeps unlisted chapters last", () => {
    const rows = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 },
    ];
    const out = applyChapterOrder(rows, ["c", "zzz", "a"]);
    expect(out.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(out.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it("builds the outline route", () => {
    expect(outlineHref("p1")).toBe("/project/p1/outline");
  });
});

describe("dragShift", () => {
  it("slides the rows a downward drag passes up by one row", () => {
    expect([0, 1, 2, 3, 4].map((i) => dragShift(i, 1, 3, 96))).toEqual([0, 0, -96, -96, 0]);
  });

  it("slides the rows an upward drag passes down by one row", () => {
    expect([0, 1, 2, 3, 4].map((i) => dragShift(i, 3, 1, 96))).toEqual([0, 96, 96, 0, 0]);
  });

  it("leaves everything alone when nothing is dragged or the row has not moved", () => {
    expect([0, 1, 2].map((i) => dragShift(i, -1, -1))).toEqual([0, 0, 0]);
    expect([0, 1, 2].map((i) => dragShift(i, 1, 1))).toEqual([0, 0, 0]);
  });
});
