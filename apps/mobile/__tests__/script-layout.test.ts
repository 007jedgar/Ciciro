import { Platform } from "react-native";
import {
  ELEMENT_METRICS,
  PAGE_COLUMNS,
  SCREENPLAY_ELEMENTS,
  SPEECH_RUNS,
  nextElementOnEnter,
} from "../lib/screenplay";

const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));

function load(): typeof import("../lib/script-layout") {
  let mod!: typeof import("../lib/script-layout");
  jest.isolateModules(() => {
    mod = require("../lib/script-layout");
  });
  return mod;
}

describe("the page the native editor lays a script out on", () => {
  const config = JSON.parse(load().screenplayLayoutConfig());

  it("is the shared engine's page, not numbers of its own", () => {
    expect(config.columns).toBe(PAGE_COLUMNS);
    expect(Object.keys(config.elements).sort()).toEqual([...SCREENPLAY_ELEMENTS].sort());
    for (const element of SCREENPLAY_ELEMENTS) {
      const { indent, width, align, caps } = ELEMENT_METRICS[element];
      expect(config.elements[element]).toEqual({ indent, width, align, caps });
    }
  });

  it("follows the engine's Return rule and keeps dialogue's runs together", () => {
    for (const element of SCREENPLAY_ELEMENTS) {
      expect(config.enter[element]).toBe(nextElementOnEnter(element));
    }
    expect(config.runs).toEqual(SPEECH_RUNS.map(([from, to]) => [from, to]));
  });

  it("asks for capitals where the engine does", () => {
    const caps = SCREENPLAY_ELEMENTS.filter((element) => config.elements[element].caps);
    expect(caps).toEqual(expect.arrayContaining(["scene-heading", "character", "transition"]));
    expect(config.elements.dialogue.caps).toBe(false);
    expect(config.elements.action.caps).toBe(false);
  });
});

describe("the type the page is set in", () => {
  const { scriptEditorMetrics } = load();

  it("fits the 60 columns of the page to the width, to a quarter point", () => {
    for (const width of [320, 361, 390, 402, 430, 768]) {
      const { fontSize, lineHeight } = scriptEditorMetrics(width);
      // A column is 0.6 em wide in the mono face: the page never needs more than the width.
      expect(fontSize * 0.6 * PAGE_COLUMNS).toBeLessThanOrEqual(width);
      // And never leaves a gap of more than a quarter point's worth of columns.
      expect((fontSize + 0.25) * 0.6 * PAGE_COLUMNS).toBeGreaterThan(width - 0.5);
      expect(fontSize * 4).toBe(Math.round(fontSize * 4));
      expect(lineHeight * 4).toBe(Math.round(lineHeight * 4));
      expect(lineHeight).toBeGreaterThan(fontSize);
    }
  });

  it("never collapses to nothing on a width that is not known yet", () => {
    expect(scriptEditorMetrics(0).fontSize).toBeGreaterThanOrEqual(4);
  });
});

describe("the page layout switch", () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
    mockDisk.clear();
  });

  it("starts off, and survives an app restart once turned on", () => {
    const first = load();
    expect(first.getScriptLayout()).toBe(false);
    first.setScriptLayout(true);
    expect(load().getScriptLayout()).toBe(true);
    load().setScriptLayout(false);
    expect(load().getScriptLayout()).toBe(false);
  });

  it("is an iOS feature: it never reads as on anywhere else", () => {
    mockDisk.set("script-layout", "true");
    Platform.OS = "android";
    const android = load();
    expect(android.scriptLayoutSupported()).toBe(false);
    expect(android.getScriptLayout()).toBe(false);
    android.setScriptLayout(true);
    expect(mockDisk.get("script-layout")).toBe("true");
    expect(android.getScriptLayout()).toBe(false);
  });
});
