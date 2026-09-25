import { describe, expect, it } from "vitest";
import {
  cleanSnapshotLabel,
  diffStats,
  formatSnapshotTime,
  isSnapshotKind,
  SNAPSHOT_LABEL_MAX,
  snapshotDiff,
  snapshotTitle,
} from "@/lib/snapshot-view";

describe("snapshot view helpers", () => {
  it("diffs two chapter texts word by word, paragraphs kept", () => {
    const parts = snapshotDiff(
      "<p>The hall was cold.</p><p>She waited.</p>",
      "<p>The hall was warm.</p><p>She waited.</p>"
    );
    const removed = parts.filter((p) => p.kind === "removed").map((p) => p.text.trim());
    const added = parts.filter((p) => p.kind === "added").map((p) => p.text.trim());
    expect(removed).toEqual(["cold"]);
    expect(added).toEqual(["warm"]);
    expect(parts.map((p) => p.text).join("")).toContain("\n\n");
    expect(diffStats(parts)).toEqual({ added: 1, removed: 1 });
  });

  it("reports no changes for identical text", () => {
    const parts = snapshotDiff("<p>Same.</p>", "<p data-block-id=\"b1\">Same.</p>");
    expect(parts.every((p) => p.kind === "same")).toBe(true);
    expect(diffStats(parts)).toEqual({ added: 0, removed: 0 });
  });

  it("titles a snapshot by its name, or by how it was taken", () => {
    expect(snapshotTitle({ kind: "manual", label: "Before the big cut" })).toBe("Before the big cut");
    expect(snapshotTitle({ kind: "before_ai", label: "" })).toBe("Before Ciciro's edits");
    expect(snapshotTitle({ kind: "session", label: "  " })).toBe("End of a writing session");
  });

  it("cleans and bounds author labels", () => {
    expect(cleanSnapshotLabel("  a\n  b ")).toBe("a b");
    expect(cleanSnapshotLabel(42)).toBe("");
    expect(cleanSnapshotLabel("x".repeat(500))).toHaveLength(SNAPSHOT_LABEL_MAX);
  });

  it("recognizes only known kinds", () => {
    expect(isSnapshotKind("before_restore")).toBe(true);
    expect(isSnapshotKind("nightly")).toBe(false);
  });
});

describe("formatSnapshotTime", () => {
  const now = new Date(2026, 8, 25, 18, 0);

  it("names today and yesterday", () => {
    expect(formatSnapshotTime(new Date(2026, 8, 25, 15, 42).toISOString(), now)).toBe(
      "Today, 3:42 PM"
    );
    expect(formatSnapshotTime(new Date(2026, 8, 24, 9, 5).toISOString(), now)).toBe(
      "Yesterday, 9:05 AM"
    );
  });

  it("dates older snapshots, with the year only when it differs", () => {
    expect(formatSnapshotTime(new Date(2026, 8, 21, 15, 42).toISOString(), now)).toBe(
      "Sep 21, 3:42 PM"
    );
    expect(formatSnapshotTime(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe(
      "Dec 31, 2025, 11:59 PM"
    );
  });
});
