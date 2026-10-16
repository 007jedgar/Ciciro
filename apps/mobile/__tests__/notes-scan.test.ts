import { ApiError } from "../lib/api/client";
import {
  SCAN_IMAGE_EDGE,
  SCAN_PAGES_MAX,
  addScanPages,
  appendableFiles,
  applyRequest,
  nextUncertainRange,
  removeScanPage,
  scanFailure,
  scanFailureRetryable,
  scanNotesHref,
  scanResizeTarget,
  suggestDestination,
  uncertainCount,
  type ScanPageDraft,
} from "../lib/notes-scan";

function photos(count: number) {
  return Array.from({ length: count }, (_, i) => ({ uri: `file:///p${i}.jpg`, width: 3000, height: 4000 }));
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("scan pages", () => {
  it("adds photos in order with fresh ids", () => {
    const { pages, dropped } = addScanPages([], photos(2), ids());
    expect(pages.map((page) => page.uri)).toEqual(["file:///p0.jpg", "file:///p1.jpg"]);
    expect(pages.map((page) => page.id)).toEqual(["id-1", "id-2"]);
    expect(dropped).toBe(0);
  });

  it("stops at the cap and reports how many did not fit", () => {
    const first = addScanPages([], photos(SCAN_PAGES_MAX - 1), ids());
    const next = addScanPages(first.pages, photos(3), ids());
    expect(next.pages).toHaveLength(SCAN_PAGES_MAX);
    expect(next.dropped).toBe(2);
    expect(addScanPages(next.pages, photos(1), ids())).toMatchObject({ dropped: 1 });
  });

  it("removes one page and keeps the order of the rest", () => {
    const { pages } = addScanPages([], photos(3), ids());
    expect(removeScanPage(pages, "id-2").map((page: ScanPageDraft) => page.id)).toEqual(["id-1", "id-3"]);
    expect(removeScanPage(pages, "missing")).toHaveLength(3);
  });
});

describe("scanResizeTarget", () => {
  it("shrinks the long side to the cap and keeps the shape", () => {
    expect(scanResizeTarget(3000, 4000)).toEqual({ width: 1350, height: SCAN_IMAGE_EDGE });
    expect(scanResizeTarget(4000, 3000)).toEqual({ width: SCAN_IMAGE_EDGE, height: 1350 });
  });

  it("leaves a photo that is already small enough", () => {
    expect(scanResizeTarget(1200, 1800)).toBeNull();
    expect(scanResizeTarget(SCAN_IMAGE_EDGE, 900)).toBeNull();
  });

  it("does nothing for a size it cannot trust", () => {
    expect(scanResizeTarget(0, 4000)).toBeNull();
    expect(scanResizeTarget(Number.NaN, 4000)).toBeNull();
  });
});

describe("scanFailure", () => {
  it("calls a lost connection offline", () => {
    expect(scanFailure(new TypeError("Network request failed"))).toEqual({ kind: "offline" });
  });

  it("separates the AI allowance from other 402s", () => {
    const limit = new ApiError("Limit", 402, { code: "ai_limit_reached", entitlement: { plan: "pro" } });
    expect(scanFailure(limit)).toEqual({ kind: "limit", plan: "pro" });
    expect(scanFailure(new ApiError("Limit", 402, { code: "ai_limit_reached" }))).toEqual({
      kind: "limit",
      plan: "free",
    });
    expect(scanFailure(new ApiError("Payment", 402, {})).kind).toBe("unavailable");
  });

  it("maps size, busy and timeout answers", () => {
    expect(scanFailure(new ApiError("Too big", 413)).kind).toBe("tooLarge");
    expect(scanFailure(new ApiError("Slow down", 429)).kind).toBe("busy");
    expect(scanFailure(new ApiError("Overloaded", 529)).kind).toBe("busy");
    expect(scanFailure(new ApiError("Gateway", 504)).kind).toBe("timeout");
  });

  it("says unavailable when the server cannot read photos at all", () => {
    expect(scanFailure(new ApiError("No key", 503)).kind).toBe("unavailable");
  });

  it("falls back to unknown", () => {
    expect(scanFailure(new Error("what"))).toEqual({ kind: "unknown" });
  });

  it("only offers another try when one could work", () => {
    expect(scanFailureRetryable("offline")).toBe(true);
    expect(scanFailureRetryable("busy")).toBe(true);
    expect(scanFailureRetryable("limit")).toBe(false);
    expect(scanFailureRetryable("tooLarge")).toBe(false);
    expect(scanFailureRetryable("unavailable")).toBe(false);
  });
});

describe("uncertain words", () => {
  const text = "Mara [?] walked to the [illegible] gate. She said [?].";

  it("counts both marks", () => {
    expect(uncertainCount(text)).toBe(3);
    expect(uncertainCount("All clear.")).toBe(0);
    expect(uncertainCount("[ILLEGIBLE] and [?]")).toBe(2);
  });

  it("finds the next mark after the cursor, then wraps", () => {
    const first = nextUncertainRange(text, 0);
    expect(first).toEqual({ start: 5, end: 8 });
    const second = nextUncertainRange(text, first!.end);
    expect(text.slice(second!.start, second!.end)).toBe("[illegible]");
    const third = nextUncertainRange(text, second!.end);
    expect(text.slice(third!.start, third!.end)).toBe("[?]");
    expect(nextUncertainRange(text, third!.end)).toEqual(first);
  });

  it("finds none in clean text", () => {
    expect(nextUncertainRange("All clear.", 0)).toBeNull();
  });
});

describe("applyRequest", () => {
  it("needs a destination and some text", () => {
    expect(applyRequest(null, "words")).toBeNull();
    expect(applyRequest({ kind: "canvas" }, "   \n")).toBeNull();
  });

  it("builds an append for a bible file", () => {
    expect(applyRequest({ kind: "bible-file", path: "world.md" }, "  The salt flats.  ")).toEqual({
      text: "The salt flats.",
      destination: { type: "bible", mode: "append", path: "world.md" },
    });
  });

  it("builds a new entry only once it has a name", () => {
    expect(applyRequest({ kind: "bible-new", entry: "character", name: "  " }, "x")).toBeNull();
    expect(applyRequest({ kind: "bible-new", entry: "plot", name: "The   heist " }, "x")).toEqual({
      text: "x",
      destination: { type: "bible", mode: "new", kind: "plot", name: "The heist" },
    });
  });

  it("builds a canvas request", () => {
    expect(applyRequest({ kind: "canvas" }, "- one\n- two")).toEqual({
      text: "- one\n- two",
      destination: { type: "canvas" },
    });
  });
});

describe("suggestDestination", () => {
  const files = [
    { path: "canon.md", summary: "" },
    { path: "characters/mara-voss.md", summary: "" },
    { path: "characters/ada.md", summary: "" },
  ];

  it("sends a list of scenes to the canvas", () => {
    expect(suggestDestination({ kind: "outline", title: "" }, files)).toEqual({ kind: "canvas" });
  });

  it("sends world, plot and timeline notes to their files", () => {
    expect(suggestDestination({ kind: "world", title: "" }, files)).toEqual({ kind: "bible-file", path: "world.md" });
    expect(suggestDestination({ kind: "plot", title: "" }, files)).toEqual({ kind: "bible-file", path: "plot.md" });
    expect(suggestDestination({ kind: "timeline", title: "" }, files)).toEqual({
      kind: "bible-file",
      path: "timeline.md",
    });
  });

  it("finds a character's existing file by name", () => {
    expect(suggestDestination({ kind: "character", title: "Mara Voss" }, files)).toEqual({
      kind: "bible-file",
      path: "characters/mara-voss.md",
    });
  });

  it("proposes a new character file when there is none", () => {
    expect(suggestDestination({ kind: "character", title: "Tobias" }, files)).toEqual({
      kind: "bible-new",
      entry: "character",
      name: "Tobias",
    });
  });

  it("suggests nothing for notes it cannot place", () => {
    expect(suggestDestination({ kind: "other", title: "Grocery list" }, files)).toBeNull();
  });
});

describe("appendableFiles", () => {
  it("lists core files first, then characters, then plot lines, and skips non-markdown", () => {
    const files = [
      { path: "plot/heist.md", summary: "" },
      { path: "characters/ada.md", summary: "" },
      { path: "world.md", summary: "" },
      { path: "notes.txt", summary: "" },
      { path: "canon.md", summary: "" },
    ];
    expect(appendableFiles(files).map((file) => file.path)).toEqual([
      "world.md",
      "canon.md",
      "characters/ada.md",
      "plot/heist.md",
    ]);
  });
});

describe("scanNotesHref", () => {
  it("opens the scanner, optionally aimed", () => {
    expect(scanNotesHref("p1")).toBe("/project/p1/scan-notes");
    expect(scanNotesHref("p1", "canvas")).toBe("/project/p1/scan-notes?to=canvas");
    expect(scanNotesHref("p1", "bible")).toBe("/project/p1/scan-notes?to=bible");
  });
});
