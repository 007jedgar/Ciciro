import i18n from "../lib/i18n";
import {
  diffStats,
  formatSnapshotTime,
  restoreSummary,
  snapshotDiff,
  snapshotTitle,
} from "../lib/snapshots";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;

describe("chapter snapshot helpers", () => {
  it("diffs the current text against a version, paragraphs kept", () => {
    const parts = snapshotDiff(
      '<p data-block-id="a">The hall was warm.</p><p data-block-id="b">She waited.</p>',
      "<p>The hall was cold.</p><p>She waited.</p>"
    );
    expect(parts.filter((p) => p.kind === "removed").map((p) => p.text.trim())).toEqual(["warm"]);
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text.trim())).toEqual(["cold"]);
    expect(parts.map((p) => p.text).join("")).toContain("\n\n");
    expect(diffStats(parts)).toEqual({ added: 1, removed: 1 });
  });

  it("says what a restore would do", () => {
    expect(restoreSummary({ added: 0, removed: 0 }, t)).toBe("Same as the current text.");
    expect(restoreSummary({ added: 1, removed: 0 }, t)).toBe("Restoring brings back 1 word.");
    expect(restoreSummary({ added: 0, removed: 4 }, t)).toBe("Restoring removes 4 words.");
    expect(restoreSummary({ added: 3, removed: 1 }, t)).toBe(
      "Restoring brings back 3 words and removes 1 word."
    );
  });

  it("titles a version by its name, or by how it was taken", async () => {
    expect(snapshotTitle({ kind: "manual", label: "Before the cut" }, t)).toBe("Before the cut");
    expect(snapshotTitle({ kind: "before_ai", label: "" }, t)).toBe("Before Ciciro's edits");
    await i18n.changeLanguage("es");
    expect(snapshotTitle({ kind: "session", label: " " }, t)).toBe("Fin de una sesión de escritura");
  });

  it("names today and yesterday, and dates anything older", () => {
    const now = new Date(2026, 8, 25, 18, 0);
    expect(formatSnapshotTime(new Date(2026, 8, 25, 15, 42).toISOString(), "en", t, now)).toBe(
      "Today, 3:42 PM"
    );
    expect(formatSnapshotTime(new Date(2026, 8, 24, 9, 5).toISOString(), "en", t, now)).toBe(
      "Yesterday, 9:05 AM"
    );
    expect(formatSnapshotTime(new Date(2026, 8, 21, 15, 42).toISOString(), "en", t, now)).toBe(
      "Sep 21, 3:42 PM"
    );
    expect(formatSnapshotTime(new Date(2025, 11, 31, 23, 59).toISOString(), "en", t, now)).toBe(
      "Dec 31, 2025, 11:59 PM"
    );
  });
});
