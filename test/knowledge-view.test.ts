import { describe, expect, it } from "vitest";
import {
  KNOWS_END,
  KNOWS_START,
  formatWhoKnowsList,
  knowledgeSectionAddon,
  withKnowsBlock,
} from "@/lib/knowledge-view";

const mara = "# Mara\n\n**Role:** narrator\n";

describe("withKnowsBlock", () => {
  it("appends a mirror block without touching the rest of the file", () => {
    const next = withKnowsBlock(mara, [{ stance: "knows", fact: "The vault is empty" }]);
    expect(next.startsWith("# Mara")).toBe(true);
    expect(next).toContain("**Role:** narrator");
    expect(next).toContain(KNOWS_START);
    expect(next).toContain("- knows (before the story): The vault is empty");
    expect(next).toContain(KNOWS_END);
  });

  it("rewrites only the block when facts change", () => {
    const first = withKnowsBlock(mara, [{ stance: "knows", fact: "The vault is empty" }]);
    const second = withKnowsBlock(first, [
      { stance: "knows", fact: "The vault is empty" },
      { stance: "believes_wrong", fact: "Auguste is dead", chapterTitle: "The Wake" },
    ]);
    expect(second).toContain("**Role:** narrator");
    expect(second.match(/knows:start/g)).toHaveLength(1);
    expect(second).toContain('- wrongly believes (from "The Wake"): Auguste is dead');
    expect(second).not.toMatch(/vault is empty[\s\S]*vault is empty/);
  });

  it("removes the block when nothing is active", () => {
    const first = withKnowsBlock(mara, [{ stance: "knows", fact: "The vault is empty" }]);
    const cleared = withKnowsBlock(first, []);
    expect(cleared).not.toContain(KNOWS_START);
    expect(cleared).toContain("**Role:** narrator");
  });
});

describe("formatWhoKnowsList", () => {
  it("caps the always-on list", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      label: "mara",
      stance: "knows",
      fact: `fact ${i} `.repeat(8),
    }));
    const block = formatWhoKnowsList(items, { maxFacts: 12, maxChars: 200 });
    expect(block.startsWith("# WHO KNOWS WHAT")).toBe(true);
    expect(block.split("\n").length).toBeLessThanOrEqual(13);
    expect(block.length).toBeLessThanOrEqual(400);
  });
});

describe("knowledgeSectionAddon", () => {
  it("reads every stance as a sentence the continuity check can quote", () => {
    const addon = knowledgeSectionAddon([
      { stance: "knows", fact: "The vault is empty" },
      { stance: "suspects", fact: "Cole lied" },
      { stance: "believes_wrong", fact: "Auguste is dead" },
      { stance: "unaware", fact: "The map is forged" },
    ]);
    expect(addon).toContain("## Who knows what (as of this chapter)");
    expect(addon).toContain("- knows: The vault is empty");
    expect(addon).toContain("- suspects: Cole lied");
    expect(addon).toContain("- wrongly believes: Auguste is dead");
    expect(addon).toContain("- does not know: The map is forged");
  });
});

describe("formatWhoKnowsList", () => {
  it("names the chapter each line dates from and reads legacy believes as suspects", () => {
    const block = formatWhoKnowsList(
      [
        { label: "joe", stance: "believes", fact: "Suzy has the pen", since: "from ch. 6" },
        { label: "joe", stance: "unaware", fact: "Mara took it" },
      ],
      { heading: "# WHO KNOWS WHAT as of the end of chapter 6" }
    );
    expect(block).toBe(
      [
        "# WHO KNOWS WHAT as of the end of chapter 6",
        "- joe suspects: Suzy has the pen [from ch. 6]",
        "- joe does not know: Mara took it",
      ].join("\n")
    );
  });
});
