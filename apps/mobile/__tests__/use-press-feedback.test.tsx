import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { Text } from "react-native";
import { TapPressable } from "../components/TapPressable";
import { setHapticsEnabled } from "../lib/haptics";
import {
  FREQ_DELETE_MS,
  FREQ_HOLD_MS,
  FREQ_TYPE_MS,
  POP_PEAK,
  PRESS_DIM,
  PRESS_IN_MS,
  PRESS_OUT_MS,
  PRESS_SCALE,
  SELECT_FADE_MS,
  TINT_MIX,
} from "../lib/motion";
import { THEME_PALETTES } from "../lib/theme";
import { pressTint, rowHighlightTint } from "../lib/use-press-feedback";

jest.mock("../lib/prefs", () => {
  const disk = new Map<string, string>();
  return {
    getPrefs: () => ({
      getString: (key: string) => disk.get(key),
      set: (key: string, value: string) => void disk.set(key, value),
    }),
  };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

const colors = THEME_PALETTES.ciciro;

describe("press tokens", () => {
  it("match the delight plan's spec table", () => {
    expect([PRESS_IN_MS, PRESS_OUT_MS]).toEqual([90, 180]);
    expect(PRESS_SCALE).toEqual({ card: 0.98, button: 0.97, chip: 0.96, fab: 0.92 });
    expect(PRESS_DIM).toEqual({ surface: 0.92, link: 0.55 });
    expect(TINT_MIX).toBe(0.2);
    expect([POP_PEAK, SELECT_FADE_MS]).toEqual([1.06, 180]);
    expect([FREQ_HOLD_MS, FREQ_DELETE_MS, FREQ_TYPE_MS]).toEqual([2600, 26, 42]);
  });
});

describe("pressTint", () => {
  it("moves an accent fill toward the ink colour", () => {
    const tint = pressTint({ backgroundColor: colors.accent }, colors);
    expect(tint?.from).toBe(colors.accent);
    expect(tint?.to).not.toBe(colors.accent);
  });

  it("eases a neutral fill toward panel2, and a panel2 fill toward ink", () => {
    expect(pressTint({ backgroundColor: colors.panel }, colors)).toEqual({ from: colors.panel, to: colors.panel2 });
    const onPanel2 = pressTint({ backgroundColor: colors.panel2 }, colors);
    expect(onPanel2?.to).not.toBe(colors.panel2);
  });

  it("gives a transparent or translucent surface nothing to ease", () => {
    expect(pressTint({ backgroundColor: "transparent" }, colors)).toBeNull();
    expect(pressTint({ backgroundColor: "rgba(0,0,0,0.5)" }, colors)).toBeNull();
    expect(pressTint(undefined, colors)).toBeNull();
  });

  it("treats a card with no fill as sitting on the panel", () => {
    expect(pressTint(undefined, colors, { assumePanel: true })).toEqual({ from: colors.panel, to: colors.panel2 });
  });
});

describe("rowHighlightTint", () => {
  it("fades panel2 in from nothing on a transparent row", () => {
    const tint = rowHighlightTint({ backgroundColor: "transparent" }, colors);
    expect(tint.to).toBe(colors.panel2);
    expect(tint.from).toMatch(/^rgba\(.*, 0\)$/);
  });

  it("starts from the row's own solid fill", () => {
    expect(rowHighlightTint({ backgroundColor: colors.bg }, colors)).toEqual({ from: colors.bg, to: colors.panel2 });
  });
});

describe("TapPressable", () => {
  beforeEach(() => {
    setHapticsEnabled(true);
    jest.clearAllMocks();
  });

  it.each(["scale", "dim", "none"] as const)("still presses with feedback=%s", (feedback) => {
    const onPress = jest.fn();
    render(
      <TapPressable feedback={feedback} onPress={onPress} accessibilityLabel="Go">
        <Text>Go</Text>
      </TapPressable>
    );
    fireEvent(screen.getByLabelText("Go"), "pressIn");
    fireEvent.press(screen.getByLabelText("Go"));
    fireEvent(screen.getByLabelText("Go"), "pressOut");
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("gives the selection detent for choosing among options", () => {
    render(
      <TapPressable haptic="select" onPress={jest.fn()} accessibilityLabel="Pick">
        <Text>Pick</Text>
      </TapPressable>
    );
    fireEvent.press(screen.getByLabelText("Pick"));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("is silent when the handler owns the haptic", () => {
    render(
      <TapPressable haptic="none" onPress={jest.fn()} accessibilityLabel="Own">
        <Text>Own</Text>
      </TapPressable>
    );
    fireEvent.press(screen.getByLabelText("Own"));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });
});
