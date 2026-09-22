import { CHAT_JUMP_THRESHOLD, isScrolledFromBottom } from "../lib/chat-scroll";

describe("isScrolledFromBottom", () => {
  it("stays hidden near the tail and appears once the author has gone far enough up", () => {
    expect(isScrolledFromBottom(2000, 600, 1400)).toBe(false);
    expect(isScrolledFromBottom(2000, 600, 2000 - 600 - CHAT_JUMP_THRESHOLD)).toBe(false);
    expect(isScrolledFromBottom(2000, 600, 0)).toBe(true);
    expect(isScrolledFromBottom(500, 600, 0)).toBe(false);
  });
});
