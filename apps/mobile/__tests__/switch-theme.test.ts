import { switchColors } from "../lib/switch-theme";

describe("switchColors", () => {
  it("themes track and thumb for on and off, including react-native-web's on thumb", () => {
    const props = switchColors({ line: "#111", accent: "#222", panel: "#333" });
    expect(props.trackColor).toEqual({ false: "#111", true: "#222" });
    expect(props.thumbColor).toBe("#333");
    expect((props as { activeThumbColor?: string }).activeThumbColor).toBe("#333");
  });
});
