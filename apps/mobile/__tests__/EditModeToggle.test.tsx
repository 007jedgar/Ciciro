import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import * as Reanimated from "react-native-reanimated";
import type { ReactNode } from "react";
import { EditModeToggle } from "../components/EditModeToggle";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import type { EditMode } from "../lib/edit-mode";
import { colors, makeLayout } from "../lib/theme";

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

// Options laid out as they would be in a row with 3px padding and a 2px gap,
// deliberately unequal widths (labels size their own option).
const EDITS = { x: 3, y: 3, width: 85, height: 24 };
const CHAT = { x: 90, y: 3, width: 70, height: 24 };

function toggle(mode: EditMode, onChange = jest.fn()) {
  const ui: ReactNode = (
    <AppThemeContext.Provider
      value={{
        settings: defaultSettings(),
        colors,
        layout: makeLayout(colors),
        dark: false,
        patch: () => {},
      }}
    >
      <EditModeToggle mode={mode} onChange={onChange} />
    </AppThemeContext.Provider>
  );
  return ui;
}

function layOut() {
  const [edits, chat] = screen.getAllByRole("radio");
  fireEvent(edits, "layout", { nativeEvent: { layout: EDITS } });
  fireEvent(chat, "layout", { nativeEvent: { layout: CHAT } });
}

/** The sliding highlight's resolved left edge and width. */
function pill() {
  const [node] = screen.UNSAFE_root.findAll(
    (n) =>
      n.props.pointerEvents === "none" &&
      StyleSheet.flatten(n.props.style)?.transform !== undefined
  );
  const style = StyleSheet.flatten(node.props.style) as {
    width: number;
    transform: { translateX: number }[];
  };
  return { x: style.transform[0].translateX, width: style.width };
}

/**
 * Render a mode and let the pill catch up. The mock's animated style is read at
 * render time, while the component moves the pill in an effect, so a second
 * render shows what the UI runtime would draw.
 */
function show(view: ReturnType<typeof render>, mode: EditMode) {
  view.rerender(toggle(mode));
  view.rerender(toggle(mode));
}

afterEach(() => jest.restoreAllMocks());

test("the highlight sits exactly under the selected option, not an equal half", () => {
  const view = render(toggle("edits"));
  layOut();
  show(view, "edits");
  expect(pill()).toEqual({ x: EDITS.x, width: EDITS.width });
});

test("switching mode slides the highlight to the other option's own frame", () => {
  const view = render(toggle("edits"));
  layOut();
  show(view, "chat");
  expect(pill()).toEqual({ x: CHAT.x, width: CHAT.width });
  show(view, "edits");
  expect(pill()).toEqual({ x: EDITS.x, width: EDITS.width });
});

test("back-to-back option layouts keep both frames", () => {
  const view = render(toggle("chat"));
  layOut();
  show(view, "chat");
  expect(pill().width).toBe(CHAT.width);
  show(view, "edits");
  expect(pill().width).toBe(EDITS.width);
});

test("spring overshoot never pushes the highlight past the row's options", () => {
  // Mid-flight values of an underdamped spring: past Chat only, then before Allow edits.
  const spring = jest.spyOn(Reanimated, "withSpring");
  const view = render(toggle("edits"));
  layOut();

  spring.mockImplementation((() => 1.07) as never);
  show(view, "chat");
  let { x, width } = pill();
  expect(x).toBeGreaterThanOrEqual(EDITS.x);
  expect(x + width).toBeLessThanOrEqual(CHAT.x + CHAT.width + 1e-9);
  expect(x).toBeGreaterThan(CHAT.x); // still moving, not snapped

  spring.mockImplementation((() => -0.07) as never);
  show(view, "edits");
  ({ x, width } = pill());
  expect(x).toBe(EDITS.x);
  expect(x + width).toBeLessThanOrEqual(CHAT.x + CHAT.width);
});

test("tapping the other option asks to change mode; the selected one does nothing", () => {
  const onChange = jest.fn();
  render(toggle("edits", onChange));
  fireEvent.press(screen.getByRole("radio", { name: "Allow edits" }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("radio", { name: "Chat only" }));
  expect(onChange).toHaveBeenCalledWith("chat");
});
