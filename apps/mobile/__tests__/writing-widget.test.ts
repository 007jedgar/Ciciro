import {
  buildWritingWidgetSnapshot,
  SIGNED_OUT_WIDGET_SNAPSHOT,
  snapshotEquals,
  toWidgetProps,
  widgetOpenUrl,
} from "../lib/writing-widget";

describe("writing widget snapshot", () => {
  it("builds a deep link for the last reading place", () => {
    expect(widgetOpenUrl("/manuscripts")).toBe("ciciro:///manuscripts");
    expect(widgetOpenUrl("/project/p1/chapters")).toBe("ciciro:///project/p1/chapters");
  });

  it("clamps counts and prefers the last place href", () => {
    const snapshot = buildWritingWidgetSnapshot({
      words: 12.7,
      goal: 250,
      daysInLast7: 9,
      lastPlace: { screen: "/project/p1/manuscript", manuscriptId: "p1" },
    });
    expect(snapshot).toEqual({
      words: 12,
      goal: 250,
      daysInLast7: 7,
      openHref: "/project/p1/manuscript",
    });
    expect(toWidgetProps(snapshot).openUrl).toBe("ciciro:///project/p1/manuscript");
  });

  it("detects unchanged snapshots so the widget is not rewritten every stroke", () => {
    const a = buildWritingWidgetSnapshot({
      words: 10,
      goal: 250,
      daysInLast7: 3,
      lastPlace: null,
    });
    expect(snapshotEquals(a, a)).toBe(true);
    expect(snapshotEquals(a, { ...a, words: 11 })).toBe(false);
    expect(snapshotEquals(null, a)).toBe(false);
  });

  it("provides an all-zero snapshot for the signed-out state", () => {
    // Published regardless of sign-in so the widget's native layout gets
    // registered on first launch, not only after someone signs in - see
    // WritingWidgetSync.
    expect(SIGNED_OUT_WIDGET_SNAPSHOT).toEqual({
      words: 0,
      goal: 0,
      daysInLast7: 0,
      openHref: "/manuscripts",
    });
  });
});
