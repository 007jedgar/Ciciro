import { act, render } from "@testing-library/react-native";
import { ThemeWashHost } from "../components/ThemeWashHost";
import { getThemeWash, startThemeWash } from "../lib/theme-wash";

// The Reanimated mock never calls timing callbacks, so a wash here stays
// mid-spread until its host unmounts: exactly the case these tests cover.

function start(apply: () => void) {
  let started = false;
  act(() => {
    started = startThemeWash({ x: 10, y: 20, color: "#123456", apply });
  });
  return started;
}

describe("ThemeWashHost", () => {
  it("ignores a second tap while a wash is playing", () => {
    const host = render(<ThemeWashHost />);
    const apply = jest.fn();
    expect(start(apply)).toBe(true);
    expect(start(jest.fn())).toBe(false);
    host.unmount();
    expect(getThemeWash()).toBeNull();
  });

  it("still applies the theme when the host unmounts before the paper covers the screen", () => {
    const host = render(<ThemeWashHost />);
    const apply = jest.fn();
    start(apply);
    expect(apply).not.toHaveBeenCalled();

    host.unmount();

    expect(apply).toHaveBeenCalledTimes(1);
    expect(getThemeWash()).toBeNull();
    // The next tap is not ignored.
    const next = jest.fn();
    const again = render(<ThemeWashHost />);
    expect(start(next)).toBe(true);
    again.unmount();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("applies once when a modal's host and the root host both paint the wash", () => {
    const root = render(<ThemeWashHost />);
    const modal = render(<ThemeWashHost />);
    const apply = jest.fn();
    start(apply);

    // e.g. Settings dismissed with Android back mid-wash.
    modal.unmount();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(getThemeWash()).toBeNull();

    root.unmount();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
