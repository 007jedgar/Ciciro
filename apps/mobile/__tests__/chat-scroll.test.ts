import { CHAT_JUMP_FADE_SCREENS, CHAT_JUMP_START_SCREENS, jumpChipOpacity } from "../lib/chat-scroll";

describe("jumpChipOpacity", () => {
  const layout = 600;
  const start = layout * CHAT_JUMP_START_SCREENS;
  const span = layout * CHAT_JUMP_FADE_SCREENS;

  function at(distance: number) {
    return jumpChipOpacity(distance + layout, layout, 0);
  }

  it("stays invisible until two screens above the tail, then fades in across the next screen", () => {
    expect(at(0)).toBe(0);
    expect(at(layout)).toBe(0);
    expect(at(start)).toBe(0);
    expect(at(start + span / 2)).toBeCloseTo(0.5);
    expect(at(start + span)).toBe(1);
    expect(at(start + span * 3)).toBe(1);
  });

  it("stays hidden when the thread is shorter than the viewport", () => {
    expect(jumpChipOpacity(500, 600, 0)).toBe(0);
    expect(jumpChipOpacity(2000, 0, 0)).toBe(0);
  });

  it("appears at full strength as soon as the fade starts when motion is reduced", () => {
    expect(at(start)).toBe(0);
    expect(jumpChipOpacity(start + layout + 1, layout, 0, CHAT_JUMP_START_SCREENS, 0)).toBe(1);
  });
});
