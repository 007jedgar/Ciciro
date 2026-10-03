import { describe, expect, it } from "vitest";
import {
  KNOWS_END,
  KNOWS_START,
  formatWhoKnowsList,
  withKnowsBlock,
} from "@/lib/knowledge-view";

const mara = "# Mara\n\n**Role:** narrator\n";

describe("withKnowsBlock", () => {
  it("appends a mirror block without touching the rest of the file", () => {
    const next = withKnowsBlock(mara, [{ stance: "knows", fact: "The vault is empty" }]);
    expect(next.startsWith("# Mara")).toBe(true);
    expect(next).toContain("**Role:** narrator");
    expect(next).toContain(KNOWS_START);
    expect(next).toContain("- knows: The vault is empty");
    expect(next).toContain(KNOWS_END);
  });

  it("rewrites only the block when facts change", () => {
    const first = withKnowsBlock(mara, [{ stance: "knows", fact: "The vault is empty" }]);
    const second = withKnowsBlock(first, [
      { stance: "knows", fact: "The vault is empty" },
      { stance: "believes", fact: "Auguste is dead" },
    ]);
    expect(second).toContain("**Role:** narrator");
    expect(second.match(/knows:start/g)).toHaveLength(1);
    expect(second).toContain("- believes: Auguste is dead");
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
    const block = formatWhoKnowsList(items, 12, 200);
    expect(block.startsWith("# WHO KNOWS WHAT")).toBe(true);
    expect(block.split("\n").length).toBeLessThanOrEqual(13);
    expect(block.length).toBeLessThanOrEqual(400);
  });
});
