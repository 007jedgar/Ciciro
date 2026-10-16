import { clearOf } from "../components/SelectChip";

describe("clearOf", () => {
  it("fades a hex colour from itself at no opacity", () => {
    expect(clearOf("#2340e0")).toBe("#2340e000");
    expect(clearOf("#FFFFFF")).toBe("#FFFFFF00");
  });

  it("leaves the transparent keyword alone rather than appending an alpha to it", () => {
    // "transparent00" is a colour Reanimated's interpolateColor refuses to parse, which
    // crashed every segmented control whose idle and chosen borders are both transparent.
    expect(clearOf("transparent")).toBe("transparent");
  });

  it("does not guess at colours it cannot take an alpha off", () => {
    expect(clearOf("rgba(0,0,0,0.5)")).toBe("transparent");
    expect(clearOf("#abc")).toBe("transparent");
  });
});
