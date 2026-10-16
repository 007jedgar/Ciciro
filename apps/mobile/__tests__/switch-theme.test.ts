import { switchColors } from "../lib/switch-theme";

describe("switchColors", () => {
  it("themes track and thumb for on and off, including react-native-web's on thumb", () => {
    const props = switchColors({ line: "#111", accent: "#222", panel: "#333" });
    expect(props.trackColor).toEqual({ false: "#111", true: "#222" });
    expect(props.thumbColor).toBe("#333");
    expect((props as { activeThumbColor?: string }).activeThumbColor).toBe("#333");
  });

  describe("on Android", () => {
    function android(colors: Parameters<typeof switchColors>[0]) {
      let props: ReturnType<typeof switchColors> | undefined;
      jest.isolateModules(() => {
        // The isolated registry has its own react-native, so set the OS on that one first.
        require("react-native").Platform.OS = "android";
        props = require("../lib/switch-theme").switchColors(colors);
      });
      return props as ReturnType<typeof switchColors>;
    }

    it("gives a dark theme a light thumb, since a near-black one vanishes against the track", () => {
      const props = android({ line: "#2a2824", accent: "#d97b52", panel: "#1f1d19", ink: "#f2ece0" });
      expect(props.thumbColor).toBe("#f2ece0");
      expect((props as { activeThumbColor?: string }).activeThumbColor).toBe("#f2ece0");
    });

    it("keeps a light theme's panel as the thumb", () => {
      const props = android({ line: "#d9d4c8", accent: "#2340e0", panel: "#fffef9", ink: "#141414" });
      expect(props.thumbColor).toBe("#fffef9");
    });
  });
});
