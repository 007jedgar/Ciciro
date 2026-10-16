type KeyboardState = { isVisible: boolean; height: number };

function covering(os: "ios" | "android", state: KeyboardState): boolean {
  let result: boolean | undefined;
  jest.isolateModules(() => {
    // The isolated registry has its own react-native, so set the OS on that one first.
    require("react-native").Platform.OS = os;
    jest.doMock("react-native-keyboard-controller", () => ({
      useKeyboardState: (select: (s: KeyboardState) => boolean) => select(state),
    }));
    result = require("../lib/use-covering-keyboard").useCoveringKeyboard();
  });
  return result as boolean;
}

describe("useCoveringKeyboard", () => {
  it("is false while no keyboard is shown", () => {
    expect(covering("ios", { isVisible: false, height: 0 })).toBe(false);
    expect(covering("android", { isVisible: false, height: 0 })).toBe(false);
  });

  it("takes the platform's word for a keyboard on iOS, whatever its height", () => {
    expect(covering("ios", { isVisible: true, height: 336 })).toBe(true);
    expect(covering("ios", { isVisible: true, height: 0 })).toBe(true);
  });

  it("counts a docked keyboard on Android", () => {
    expect(covering("android", { isVisible: true, height: 300 })).toBe(true);
  });

  it("ignores a floating IME add-on on Android, which reports visible but covers nothing", () => {
    expect(covering("android", { isVisible: true, height: 0 })).toBe(false);
    expect(covering("android", { isVisible: true, height: 56 })).toBe(false);
  });
});
