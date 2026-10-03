import { describe, expect, it } from "vitest";
import { parseFillReply, parseOptionsReply, parseOutlineReply, placeOutline } from "@/lib/canvas-view";

describe("outline JSON", () => {
  it("parses a tree of parts and lays them under the premise", () => {
    const raw = JSON.stringify({
      nodes: [
        {
          title: "Part 1: The Ordinary World",
          body: "Home.",
          children: [{ title: "Part 2: The Call", body: "A letter.", children: [] }],
        },
      ],
    });
    const nodes = parseOutlineReply(raw);
    expect(nodes).toHaveLength(1);
    const placed = placeOutline(nodes!, { x: 40, y: 20 });
    expect(placed.map((card) => card.title)).toEqual([
      "Part 1: The Ordinary World",
      "Part 2: The Call",
    ]);
    expect(placed[0].parentKey).toBeNull();
    expect(placed[1].parentKey).toBe(placed[0].key);
    expect(placed[1].y).toBeGreaterThan(placed[0].y);
  });

  it("returns nothing for empty, truncated, or non-JSON replies", () => {
    expect(parseOutlineReply("")).toBeNull();
    expect(parseOutlineReply("{")).toBeNull();
    expect(parseOutlineReply('{"title":"Part 1"')).toBeNull();
    expect(parseOutlineReply('{"nodes":[{"title":"Part 1: Home"')).toBeNull();
    expect(parseOutlineReply("not json at all")).toBeNull();
    expect(parseOutlineReply('{"nodes":[]}')).toBeNull();
  });
});

describe("fill and options JSON", () => {
  it("reads one body or exactly three options", () => {
    expect(parseFillReply('{"body":"She leaves at dawn."}')).toBe("She leaves at dawn.");
    expect(parseFillReply("{")).toBeNull();
    expect(parseOptionsReply('{"options":["a","b","c"]}')).toEqual(["a", "b", "c"]);
    expect(parseOptionsReply('{"options":["only one"]}')).toBeNull();
    expect(parseOptionsReply('{"options":["a","b"')).toBeNull();
  });
});
