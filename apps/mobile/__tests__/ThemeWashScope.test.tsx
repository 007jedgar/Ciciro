import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { ThemeWashScope } from "../components/ThemeWashScope";
import { getThemeWash, startThemeWash } from "../lib/theme-wash";

// The Reanimated mock never calls timing callbacks, so a wash here stays open
// until its scope unmounts: exactly the case these tests cover.

function start(apply: () => void) {
  let started = false;
  act(() => {
    started = startThemeWash({ x: 10, y: 20, apply });
  });
  return started;
}

function mount() {
  return render(
    <ThemeWashScope>
      <Text>screen</Text>
    </ThemeWashScope>
  );
}

describe("ThemeWashScope", () => {
  it("renders what it wraps", () => {
    const scope = mount();
    expect(scope.getByText("screen")).toBeTruthy();
    scope.unmount();
  });

  it("ignores a second tap while a wash is playing", () => {
    const scope = mount();
    expect(start(jest.fn())).toBe(true);
    expect(start(jest.fn())).toBe(false);
    scope.unmount();
    expect(getThemeWash()).toBeNull();
  });

  it("does not swap the theme until the snapshot is on screen", () => {
    const scope = mount();
    const apply = jest.fn();
    start(apply);
    expect(apply).not.toHaveBeenCalled();
    scope.unmount();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("still changes the theme when the screen unmounts mid-wash, and frees the next tap", () => {
    const scope = mount();
    const apply = jest.fn();
    start(apply);

    scope.unmount();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(getThemeWash()).toBeNull();
    const next = jest.fn();
    const again = mount();
    expect(start(next)).toBe(true);
    again.unmount();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("only the innermost scope takes the wash, so the theme swaps once", async () => {
    const root = mount();
    const modal = mount();
    const apply = jest.fn();
    start(apply);
    await act(async () => {});

    // e.g. Settings dismissed with Android back mid-wash.
    modal.unmount();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(getThemeWash()).toBeNull();

    root.unmount();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
