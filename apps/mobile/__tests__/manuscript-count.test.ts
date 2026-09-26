import i18n from "../lib/i18n";
import { manuscriptCountLabel, manuscriptMetaParts } from "../lib/manuscript-count";

const t = i18n.t.bind(i18n);

describe("manuscript count", () => {
  it("counts in the kind's own unit", () => {
    expect(manuscriptCountLabel("novel", 2, t)).toBe("2 chapters");
    expect(manuscriptCountLabel("journal", 1, t)).toBe("1 entry");
    expect(manuscriptCountLabel("blog", 3, t)).toBe("3 posts");
    expect(manuscriptCountLabel("screenplay", 1, t)).toBe("1 sequence");
    expect(manuscriptCountLabel(undefined, 1, t)).toBe("1 chapter");
  });

  it("labels the kind for anything but a novel", () => {
    expect(manuscriptMetaParts({ kind: "journal", genre: "", _count: { chapters: 1 } }, t)).toEqual({
      kindLabel: "Journal",
      text: "1 entry",
    });
    expect(manuscriptMetaParts({ kind: "novel", genre: "Fantasy", _count: { chapters: 4 } }, t)).toEqual({
      kindLabel: null,
      text: "Fantasy · 4 chapters",
    });
    expect(manuscriptMetaParts({ kind: "novel" }, t).text).toBe("Manuscript");
  });
});
